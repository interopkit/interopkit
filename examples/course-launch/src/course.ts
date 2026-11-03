/** The address that the campus serves the files of its courses from. */
export const CONTENT = "https://content.campus.example/geology/";

/** The publisher ids of the assignable units of the course. */
export const ROCKS = "https://publisher.example/geology/rocks";
export const GLOSSARY = "https://publisher.example/geology/glossary";
export const MINERALS = "https://publisher.example/geology/minerals";

/**
 * The `cmi5.xml` of a geology course: a block with a unit that the learner completes and passes at 0.8, and a glossary that
 * needs nothing, then a unit of its own that the learner completes in a window of its own.
 */
export const GEOLOGY = `<?xml version="1.0" encoding="utf-8"?>
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="https://publisher.example/geology">
    <title><langstring lang="en-US">Geology</langstring></title>
    <description><langstring lang="en-US">Rocks and minerals.</langstring></description>
  </course>
  <block id="https://publisher.example/geology/basics">
    <title><langstring lang="en-US">Basics</langstring></title>
    <description><langstring lang="en-US">The kinds of rock and their words.</langstring></description>
    <au id="${ROCKS}" moveOn="CompletedAndPassed" masteryScore="0.8">
      <title><langstring lang="en-US">Rocks</langstring></title>
      <description><langstring lang="en-US">Igneous, sedimentary and metamorphic rock.</langstring></description>
      <url>rocks/index.html</url>
    </au>
    <au id="${GLOSSARY}" moveOn="NotApplicable">
      <title><langstring lang="en-US">Glossary</langstring></title>
      <description><langstring lang="en-US">The words of the course.</langstring></description>
      <url>glossary/index.html</url>
    </au>
  </block>
  <au id="${MINERALS}" moveOn="Completed" launchMethod="OwnWindow">
    <title><langstring lang="en-US">Minerals</langstring></title>
    <description><langstring lang="en-US">Crystals and their hardness.</langstring></description>
    <url>minerals/index.html?lang=en</url>
  </au>
</courseStructure>
`;
