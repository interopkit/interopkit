<?php
// The configuration of the Moodle that pnpm moodle starts: the database and the address come from the environment of the run.
unset($CFG);
global $CFG;
$CFG = new stdClass();

$CFG->dbtype = 'mariadb';
$CFG->dblibrary = 'native';
$CFG->dbhost = 'db';
$CFG->dbname = 'moodle';
$CFG->dbuser = 'moodle';
$CFG->dbpass = getenv('MOODLE_DB_PASSWORD');
$CFG->prefix = 'mdl_';
$CFG->dboptions = ['dbpersist' => 0, 'dbport' => '', 'dbsocket' => '', 'dbcollation' => 'utf8mb4_unicode_ci'];

$CFG->wwwroot = getenv('MOODLE_WWWROOT');
$CFG->dataroot = '/var/www/moodledata';
$CFG->admin = 'admin';
$CFG->directorypermissions = 02777;

// The run reaches Moodle over plain HTTP on the loopback address and names it by its https address.
$CFG->sslproxy = true;
// Moodle fetches the key set of the tool and the configuration of the platform at the machine that runs the tests, which is
// a private address and a port other than 80 and 443; its cURL helper refuses both by default.
$CFG->curlsecurityblockedhosts = '';
$CFG->curlsecurityallowedport = '';
$CFG->noemailever = true;
$CFG->debug = 15;
$CFG->debugdisplay = 0;

require_once(__DIR__ . '/lib/setup.php');
