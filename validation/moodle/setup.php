<?php
// The part of the setup of a Moodle that is not LTI: users, a course, an activity, and what the gradebook holds. The flows of LTI
// (registration, launch, services, Deep Linking) go over HTTP as a browser and a tool make them; this script is what a person does
// in the interface of Moodle to prepare them, and what a reader of the gradebook sees afterwards.
//
//   php /opt/setup.php <command> '<arguments as JSON>'
//
// It prints one JSON object. Commands: init, reset-tools, add-activity, grades, set-grade, draft-registration, publish-tool, users, run-task, run-adhoc.

define('CLI_SCRIPT', true);
require('/var/www/html/config.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/course/modlib.php');
require_once($CFG->dirroot . '/user/lib.php');
require_once($CFG->libdir . '/enrollib.php');
require_once($CFG->libdir . '/gradelib.php');
require_once($CFG->dirroot . '/auth/lti/auth.php');

/** Prints the result and ends. */
function done($result) {
    echo json_encode($result, JSON_UNESCAPED_SLASHES), "\n";
    exit(0);
}

/** Makes a user with a known password, or returns the one that exists. */
function make_user(string $username, string $first, string $last, string $email): stdClass {
    global $DB, $CFG;
    if ($existing = $DB->get_record('user', ['username' => $username, 'mnethostid' => $CFG->mnet_localhost_id])) {
        return $existing;
    }
    $user = (object) [
        'username' => $username, 'password' => 'Passw0rd!-' . $username, 'firstname' => $first, 'lastname' => $last,
        'email' => $email, 'auth' => 'manual', 'confirmed' => 1, 'mnethostid' => $CFG->mnet_localhost_id,
    ];
    $user->id = user_create_user($user, true, false);
    return $DB->get_record('user', ['id' => $user->id], '*', MUST_EXIST);
}

/** Enrols a user in a course with the role of the given archetype. */
function enrol(stdClass $course, stdClass $user, string $archetype): void {
    global $DB;
    $role = $DB->get_record('role', ['archetype' => $archetype], '*', IGNORE_MULTIPLE);
    enrol_try_internal_enrol($course->id, $user->id, $role->id);
}

$command = $argv[1] ?? '';
$args = json_decode($argv[2] ?? '{}', true) ?: [];

if ($command === 'init') {
    set_config('passwordpolicy', 0);
    // Moodle as a tool: the enrolment method that publishes a course, and the authentication that provisions the users it launches.
    \core\plugininfo\enrol::enable_plugin('lti', 1);
    \core\plugininfo\auth::enable_plugin('lti', 1);
    $course = $DB->get_record('course', ['shortname' => 'COURSE1']);
    if (!$course) {
        $course = create_course((object) ['fullname' => 'Course 1', 'shortname' => 'COURSE1', 'category' => 1, 'format' => 'topics',
            'numsections' => 1]);
    }
    $ana = make_user('ana', 'Ana', 'Candidate', 'ana@example.edu');
    $jane = make_user('jane', 'Jane', 'Instructor', 'jane@example.edu');
    $budi = make_user('budi', 'Budi', 'Learner', 'budi@example.edu');
    enrol($course, $ana, 'student');
    enrol($course, $budi, 'student');
    enrol($course, $jane, 'editingteacher');
    done(['course' => (int) $course->id, 'users' => ['ana' => (int) $ana->id, 'jane' => (int) $jane->id, 'budi' => (int) $budi->id]]);
}

if ($command === 'reset-tools') {
    // Removes the external tools that registered themselves, with their activities, so that a run starts from the course alone.
    require_once($CFG->dirroot . '/mod/lti/locallib.php');
    $removed = 0;
    $DB->delete_records('task_adhoc');
    $DB->delete_records('grade_items', ['itemtype' => 'manual']);
    $module = $DB->get_field('modules', 'id', ['name' => 'lti']);
    foreach ($DB->get_records('course_modules', ['module' => $module]) as $cm) {
        course_delete_module($cm->id);
    }
    foreach ($DB->get_records('lti_types') as $type) {
        lti_delete_type($type->id);
        $removed += 1;
    }
    // The same for Moodle as a tool: what was published, the platforms registered, and the users that they launched.
    $plugin = enrol_get_plugin('lti');
    foreach ($DB->get_records('enrol', ['enrol' => 'lti']) as $instance) {
        $plugin->delete_instance($instance);
    }
    foreach ($DB->get_records('user', ['auth' => 'lti']) as $user) {
        delete_user($user);
    }
    foreach (['enrol_lti_user_resource_link', 'enrol_lti_users', 'enrol_lti_resource_link', 'enrol_lti_context', 'enrol_lti_deployment',
        'enrol_lti_app_registration', 'enrol_lti_tools'] as $table) {
        if ($DB->get_manager()->table_exists($table)) {
            $DB->delete_records($table);
        }
    }
    done(['removed' => $removed]);
}

if ($command === 'add-activity') {
    $course = $DB->get_record('course', ['shortname' => 'COURSE1'], '*', MUST_EXIST);
    $module = $DB->get_record('modules', ['name' => 'lti'], '*', MUST_EXIST);
    $info = (object) [
        'modulename' => 'lti', 'module' => $module->id, 'course' => $course->id, 'section' => 0, 'visible' => 1,
        'visibleoncoursepage' => 1, 'name' => $args['name'] ?? 'Quiz', 'intro' => '', 'introformat' => FORMAT_HTML,
        'typeid' => (int) $args['typeid'], 'toolurl' => $args['toolurl'] ?? '', 'securetoolurl' => '',
        'instructorchoicesendname' => 1, 'instructorchoicesendemailaddr' => 1, 'instructorchoiceacceptgrades' => 1,
        'instructorchoiceallowroster' => 1, 'instructorchoiceallowsetting' => 0, 'launchcontainer' => 3,
        'grade' => 100, 'cmidnumber' => '', 'showdescriptionlaunch' => 0, 'instructorcustomparameters' => $args['custom'] ?? '',
        'completion' => 0,
    ];
    $created = add_moduleinfo($info, $course);
    $gradeitem = $DB->get_record('grade_items', ['courseid' => $course->id, 'itemmodule' => 'lti', 'iteminstance' => $created->instance]);
    done(['cmid' => (int) $created->coursemodule, 'instance' => (int) $created->instance, 'gradeitem' => $gradeitem ? (int) $gradeitem->id : null]);
}

if ($command === 'grades') {
    $course = $DB->get_record('course', ['shortname' => 'COURSE1'], '*', MUST_EXIST);
    // A grade that arrives is final once the gradebook has recalculated, which it does when a person opens it.
    grade_regrade_final_grades($course->id);
    $items = [];
    foreach ($DB->get_records('grade_items', ['courseid' => $course->id, 'itemtype' => 'mod', 'itemmodule' => 'lti']) as $item) {
        $grades = [];
        foreach ($DB->get_records('grade_grades', ['itemid' => $item->id]) as $grade) {
            $user = $DB->get_record('user', ['id' => $grade->userid]);
            $grades[$user->username] = ['final' => $grade->finalgrade === null ? null : (float) $grade->finalgrade,
                'feedback' => $grade->feedback];
        }
        $items[] = ['id' => (int) $item->id, 'name' => $item->itemname, 'max' => (float) $item->grademax, 'grades' => $grades];
    }
    done(['items' => $items]);
}

if ($command === 'set-grade') {
    // What a teacher does in the gradebook: the grade of a user for the course.
    $course = $DB->get_record('course', ['shortname' => 'COURSE1'], '*', MUST_EXIST);
    $user = $DB->get_record('user', ['username' => $args['username']], '*', MUST_EXIST);
    // A teacher grades in an item of the gradebook; the course total, which the tool sends, is calculated from it.
    $item = grade_item::fetch(['courseid' => $course->id, 'itemtype' => 'manual', 'itemname' => 'Marks']);
    if (!$item) {
        $item = new grade_item(['courseid' => $course->id, 'itemtype' => 'manual', 'itemname' => 'Marks', 'grademax' => 100], false);
        $item->insert();
    }
    $item->update_final_grade($user->id, $args['grade'], 'manual');
    grade_regrade_final_grades($course->id);
    $total = grade_item::fetch_course_item($course->id);
    $grade = grade_grade::fetch(['itemid' => $total->id, 'userid' => $user->id]);
    done(['total' => (float) $grade->finalgrade, 'max' => (float) $total->grademax]);
}

if ($command === 'draft-registration') {
    // What an administrator does at "Register a platform" of "Publish as LTI tool": a draft that waits for the platform. The
    // address of its dynamic registration is the one that the administrator of the platform is given.
    $uniqueid = bin2hex(random_bytes(30));
    $draft = \enrol_lti\local\ltiadvantage\entity\application_registration::create_draft($args['name'] ?? 'Reference platform', $uniqueid);
    (new \enrol_lti\local\ltiadvantage\repository\application_registration_repository())->save($draft);
    done(['uniqueid' => $uniqueid, 'url' => (new moodle_url('/enrol/lti/register.php', ['token' => $uniqueid]))->out(false)]);
}

if ($command === 'publish-tool') {
    // What a teacher does at "Publish as LTI tool" of a course: a resource that a platform launches by its identifier.
    $course = $DB->get_record('course', ['shortname' => 'COURSE1'], '*', MUST_EXIST);
    $teacher = $DB->get_record('role', ['shortname' => 'editingteacher'], '*', MUST_EXIST);
    $student = $DB->get_record('role', ['shortname' => 'student'], '*', MUST_EXIST);
    $fields = [
        'name' => $args['name'] ?? 'Published course', 'courseid' => $course->id, 'contextid' => context_course::instance($course->id)->id,
        'status' => ENROL_INSTANCE_ENABLED, 'ltiversion' => 'LTI-1p3', 'roleinstructor' => $teacher->id, 'rolelearner' => $student->id,
        'provisioningmodeinstructor' => auth_plugin_lti::PROVISIONING_MODE_AUTO_ONLY,
        'provisioningmodelearner' => auth_plugin_lti::PROVISIONING_MODE_AUTO_ONLY,
        'gradesync' => 1, 'gradesynccompletion' => 0, 'membersync' => 1, 'membersyncmode' => 1, 'maxenrolled' => 0,
    ];
    $instanceid = enrol_get_plugin('lti')->add_instance($course, $fields);
    $tool = $DB->get_record('enrol_lti_tools', ['enrolid' => $instanceid], '*', MUST_EXIST);
    done(['uuid' => $tool->uuid, 'toolid' => (int) $tool->id, 'enrolid' => (int) $instanceid]);
}

if ($command === 'users') {
    // The users that the tool made, and the roles they have in the course.
    $course = $DB->get_record('course', ['shortname' => 'COURSE1'], '*', MUST_EXIST);
    $context = context_course::instance($course->id);
    $users = [];
    foreach ($DB->get_records('user', ['deleted' => 0]) as $user) {
        if (in_array($user->username, ['guest', 'admin'], true)) {
            continue;
        }
        $roles = array_map(fn($role) => $role->shortname, get_user_roles($context, $user->id, false));
        $users[$user->username] = ['first' => $user->firstname, 'last' => $user->lastname, 'email' => $user->email, 'auth' => $user->auth,
            'enrolled' => is_enrolled($context, $user), 'roles' => array_values($roles)];
    }
    done(['users' => $users]);
}

if ($command === 'run-task') {
    // What the cron of Moodle does: the task of a class, once.
    $class = $args['class'];
    $task = new $class();
    $task->execute();
    done(['ran' => $class]);
}

if ($command === 'run-adhoc') {
    // What the cron of Moodle does with the tasks of a class that other tasks queued: all that are due, once.
    $ran = [];
    while ($task = \core\task\manager::get_next_adhoc_task(time(), false, $args['class'])) {
        \core\cron::run_inner_adhoc_task($task);
        $ran[] = get_class($task);
    }
    done(['ran' => $ran]);
}

fwrite(STDERR, "Unknown command $command\n");
exit(1);
