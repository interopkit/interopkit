"""Writes the fixture of the matching of Statements against the Patterns of an xAPI Profile: patterns, the Statement Templates
that a series of Statements matches one by one, and what the matching algorithm of the specification gives for them.

The outcomes come from `matches` of ADL's reference implementation, `libraries/test_matching.py` of adlnet/xapi-profiles at
commit 287386e4f8b8d468ddc49c817462c5edf26061a6 (Apache-2.0), ported to Python 3 with no change to its logic: `basestring`
becomes `str`, and a statement is the id of the one template it matches. The cases are ADL's two example Patterns (the per-course
Pattern of cmi5 and a SCORM-like one) and Patterns drawn by the strategies of that file, each with series of Statements that
follow the Pattern, a prefix of such a series, and series drawn at random from the Pattern's templates and one foreign template.
A seeded generator makes the same fixture on every run; it needs no package beyond the standard library.
"""

import json
import random
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "packages" / "learning-records" / "test" / "fixtures" / "xapi-profile-patterns.json"
SEED = 9274
RANDOM_PATTERNS = 400

success = True
failure = False
partial = None


# ADL's `matches`, as libraries/test_matching.py writes it.
def matches(statements, element):
    if isinstance(element, str):
        if len(statements) == 0:
            return partial, []
        if statements[0] == element:
            return success, statements[1:]
        else:
            return failure, statements
    elif 'sequence' in element:
        next_statements = statements
        for next_element in element[1]:
            next_matches, next_statements = matches(next_statements, next_element)
            if next_matches is failure:
                return next_matches, statements
            if next_matches is partial:
                return partial, []
        return success, next_statements
    elif 'alternates' in element:
        next_matches, next_statements = failure, statements
        for next_element in element[1]:
            maybe_matches, maybe_statements = matches(statements, next_element)
            if maybe_matches is success:
                next_matches = success
                if len(maybe_statements) < len(next_statements):
                    next_statements = maybe_statements
            if maybe_matches is partial and next_matches is failure:
                next_matches = partial
        if next_matches is partial:
            return partial, []
        return next_matches, next_statements
    elif 'oneOrMore' in element:
        next_matches = failure
        last_statements = next_statements = statements
        while True:
            cont, next_statements = matches(last_statements, element[1])
            if cont is success:
                next_matches = success
            elif next_matches is failure and cont is partial:
                return partial, []
            else:
                if cont is partial and len(last_statements) > 0:
                    return partial, last_statements
                return next_matches, last_statements
            if len(next_statements) == len(last_statements):
                return success, next_statements
            last_statements = next_statements
    elif 'zeroOrMore' in element:
        last_statements = statements
        while True:
            cont, statements = matches(last_statements, element[1])
            if cont is failure:
                return success, last_statements
            elif cont is partial and len(statements) > 0:
                return partial, statements
            if len(statements) == len(last_statements):
                return success, statements
            last_statements = statements
    elif 'optional' in element:
        if len(statements) == 0:
            return success, []
        next_matches, next_statements = matches(statements, element[1])
        if next_matches in [success, partial]:
            return next_matches, next_statements
        else:
            return success, statements
    else:
        raise Exception("not possible")


def seq(*values):
    return "sequence", values


def alt(*values):
    return "alternates", values


def star(value):
    return "zeroOrMore", value


def plus(value):
    return "oneOrMore", value


def opt(value):
    return "optional", value


# ADL's example Patterns, as the file writes them.
scorm_activity = alt("scoactivity", "otheractivity", "commenting", "interactionactivity", "completing")
scorm_pattern = seq("initialization", star(scorm_activity), star(seq("suspension", "resumption", star(scorm_activity))), "termination")
satisfieds = star("satisfied")
terminated_or_abandoned = alt("terminated", "abandoned")
cmi5_percourse = seq(
    satisfieds,
    star(
        alt(
            seq("launched", "initialized", alt(seq(opt("completed"), satisfieds, "failed"), seq("failed", opt("completed"))), satisfieds, terminated_or_abandoned),
            seq("launched", "initialized", alt(seq("completed", satisfieds, "passed"), seq("passed", satisfieds, "completed")), satisfieds, terminated_or_abandoned),
            seq("launched", "initialized", "failed", terminated_or_abandoned),
            seq("launched", "initialized", terminated_or_abandoned),
            seq("launched", "initialized", "passed", satisfieds, terminated_or_abandoned),
            seq("launched", "initialized", "completed", satisfieds, terminated_or_abandoned),
            seq(satisfieds, "waived", satisfieds),
        )
    ),
)


# Patterns that name one Pattern from two places, where the second place starts before the first and passes it.
shared_star = star("b")
shared_plus = plus("b")
shared = [
    ("a zeroOrMore named twice", alt(seq("b", shared_star), shared_star), [["b", "b", "c"], ["b", "b", "b"], ["c"]]),
    ("a oneOrMore named twice", alt(seq("b", shared_plus), shared_plus), [["b", "b", "b", "c"], ["b", "b"], ["b"]]),
]


def draw_pattern(rng, depth, atom, ok_in_alternates):
    """A Pattern as the strategies of the file draw one: a sequence or alternates of two or more, or one of the three others."""
    kind = rng.choice(["sequence", "alternates", "zeroOrMore", "oneOrMore", "optional"])

    def member():
        if depth <= 1 or rng.random() < 0.35:
            return atom()
        return draw_pattern(rng, depth - 1, atom, ok_in_alternates)

    if kind in ("sequence", "alternates"):
        members = []
        size = rng.randint(2, 4)
        while len(members) < size:
            candidate = member()
            if kind == "alternates" and not ok_in_alternates and not isinstance(candidate, str) and candidate[0] in ("optional", "zeroOrMore"):
                continue
            members.append(candidate)
        return kind, tuple(members)
    return kind, member()


def follow(rng, pattern):
    """A series of Statements that follows a Pattern, as `pattern_to_statements` of the file draws one."""
    if isinstance(pattern, str):
        return [pattern]
    kind, value = pattern
    if kind == "sequence":
        return [statement for member in value for statement in follow(rng, member)]
    if kind == "alternates":
        return follow(rng, rng.choice(value))
    times = {"zeroOrMore": rng.randint(0, 3), "oneOrMore": rng.randint(1, 3), "optional": rng.randint(0, 1)}[kind]
    return [statement for _ in range(times) for statement in follow(rng, value)]


def atoms_of(pattern):
    if isinstance(pattern, str):
        return {pattern}
    kind, value = pattern
    members = value if kind in ("sequence", "alternates") else (value,)
    return set().union(*(atoms_of(member) for member in members))


def to_json(pattern):
    if isinstance(pattern, str):
        return pattern
    kind, value = pattern
    return [kind, [to_json(member) for member in value]] if kind in ("sequence", "alternates") else [kind, to_json(value)]


def series_for(rng, pattern, count):
    """Series that follow the Pattern, prefixes of them, and series drawn from its templates and a foreign one."""
    alphabet = sorted(atoms_of(pattern)) + ["foreign"]
    found = []
    for _ in range(count):
        followed = follow(rng, pattern)
        found.append(followed)
        found.append(followed[: rng.randint(0, max(0, len(followed) - 1))])
        found.append([rng.choice(alphabet) for _ in range(rng.randint(0, 8))])
    return found


def main():
    rng = random.Random(SEED)
    patterns = [("cmi5 per course", cmi5_percourse, 30), ("SCORM-like", scorm_pattern, 30)]
    counter = iter(range(10**6))
    for index in range(RANDOM_PATTERNS):
        distinct = index % 2 == 0
        # Distinct atoms make a Pattern that greedy matching decides; a few shared ones test the greedy choice itself.
        atom = (lambda: f"t{next(counter)}") if distinct else (lambda: rng.choice(["a", "b", "c"]))
        pattern = draw_pattern(rng, rng.randint(1, 4), atom, ok_in_alternates=not distinct)
        patterns.append((f"drawn {index}", pattern, 2))
    cases = []
    for name, pattern, count in patterns:
        series = []
        for statements in series_for(rng, pattern, count):
            outcome, remaining = matches(statements, pattern)
            label = {success: "success", partial: "partial", failure: "failure"}[outcome]
            series.append({"statements": statements, "outcome": label, "remaining": len(remaining)})
        cases.append({"name": name, "pattern": to_json(pattern), "series": series})
    for name, pattern, fixed in shared:
        series = []
        for statements in fixed:
            outcome, remaining = matches(statements, pattern)
            label = {success: "success", partial: "partial", failure: "failure"}[outcome]
            series.append({"statements": statements, "outcome": label, "remaining": len(remaining)})
        cases.append({"name": name, "pattern": to_json(pattern), "series": series})
    source = "adlnet/xapi-profiles libraries/test_matching.py at 287386e4f8b8d468ddc49c817462c5edf26061a6"
    OUTPUT.write_text(json.dumps({"source": source, "cases": cases}, separators=(",", ":")) + "\n")
    print(f"Wrote {sum(len(case['series']) for case in cases)} series of {len(cases)} Patterns to {OUTPUT}")


if __name__ == "__main__":
    main()
