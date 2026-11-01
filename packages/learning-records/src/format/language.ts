import type { ActivityDefinition, InteractionComponent, LanguageMap } from "../model/index.js";

/** The lists of components of an Activity Definition (4.2.2.3). */
const COMPONENT_LISTS = ["choices", "scale", "source", "target", "steps"] as const;

/** Keeps one entry of a language map: the first one that a preferred language asks for, or the first of the map. */
export function oneLanguage(map: LanguageMap, languages: readonly string[]): LanguageMap {
  const entries = Object.entries(map);
  for (const range of languages) {
    const wanted = range.toLowerCase();
    // A range matches a tag that equals it or that begins with it and a hyphen: `en` matches `en-US` (RFC 4647 3.3.1).
    const found =
      wanted === "*"
        ? entries[0]
        : entries.find(([tag]) => tag.toLowerCase() === wanted || tag.toLowerCase().startsWith(`${wanted}-`));
    if (found !== undefined) return Object.fromEntries([found]);
  }
  return Object.fromEntries(entries.slice(0, 1));
}

/** Keeps one language in the description of a component. */
function componentInOneLanguage(component: InteractionComponent, languages: readonly string[]): InteractionComponent {
  const { description } = component;
  return description === undefined ? component : { ...component, description: oneLanguage(description, languages) };
}

/** Keeps one language in every language map of an Activity Definition: its name and description, and its components. */
export function definitionInOneLanguage(
  definition: ActivityDefinition,
  languages: readonly string[],
): ActivityDefinition {
  const { name, description } = definition;
  const lists = COMPONENT_LISTS.flatMap((list) => {
    const components = definition[list];
    return components === undefined ? [] : [[list, components.map((c) => componentInOneLanguage(c, languages))]];
  });
  return {
    ...definition,
    ...(name === undefined ? {} : { name: oneLanguage(name, languages) }),
    ...(description === undefined ? {} : { description: oneLanguage(description, languages) }),
    ...Object.fromEntries(lists),
  };
}
