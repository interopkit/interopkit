# Makes PHP's cURL, and so Moodle, trust the certificate authority that the run made for the platform and the tool.
update-ca-certificates > /dev/null 2>&1
