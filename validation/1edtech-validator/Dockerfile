# The public validator of Open Badges and CLR, built from the commit that the lock pins; nothing of it is changed. The image keeps
# Maven and the build, so that the one stage that runs the jar is the one that built it.
FROM maven@sha256:1a352420f7aba21f5ad08df31bab55f74c013fb491f1ae8ab1dd7ff9ed698584
ARG COMMIT
ARG SHA256
# A download that brings no byte for 30 s ends, and one that fails or stalls is retried three times, as scripts/download.ts does.
RUN curl -fsSL --retry 3 --retry-all-errors --speed-time 30 --speed-limit 1 -o /validator.tar.gz https://codeload.github.com/1EdTech/digital-credentials-public-validator/tar.gz/${COMMIT} \
 && echo "${SHA256}  /validator.tar.gz" | sha256sum -c - \
 && mkdir /validator && tar -xzf /validator.tar.gz --strip-components=1 -C /validator
WORKDIR /validator
RUN mvn -B -q -DskipTests dependency:go-offline
RUN mvn -B -q -DskipTests package
# The proofs of Ed25519 use libsodium through JNA, which finds no build of it for every platform inside the jar.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends libsodium23 && rm -rf /var/lib/apt/lists/*
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/validator/inspector-vc-web/target/inspector-vc-web.jar"]
