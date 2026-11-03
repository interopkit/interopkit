/*
    The browser of CATAPULT's LMS suite, copied over the suite's own: the Chromium of the repository's Playwright, whose path the
    run gives in CHROMIUM_PATH, since the suite's Puppeteer downloads none. The certificate of the run is made for 127.0.0.1 and
    for this run alone, which the browser of the run takes.
*/
module.exports = {
  launch: {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox", "--ignore-certificate-errors"],
  },
};
