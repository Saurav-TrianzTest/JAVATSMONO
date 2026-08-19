# storefront-ts

Java (Spring Boot) application with embedded TypeScript source, used to test
TypeScript violation detection when TS code is bundled inside a Java repo.
Not a comprehensive cz-ts rule fixture — partial rule coverage is expected
and acceptable.

## Structure

This is a single, standard Maven project (one `pom.xml` at the repo root — no nested
or multi-module POMs, and no `package.json`/npm tooling to be misread as a second
module) with a Java backend and embedded TypeScript source for scanner-detection
purposes:

- Backend (Java, Spring Boot) — `src/main/java/com/trianz/storefront/`, layered
  architecture (controller → service), exposing `GET /api/health`.
  Build with `mvn package` from the repo root; run with
  `java -jar target/storefront-backend-1.0.0.jar`. Tests: `src/test/java`
  (Spring `MockMvc` coverage of the health endpoint), run with `mvn test`.
- TypeScript fixture — `ts-frontend/` (kept out of the `src/` Maven tree on
  purpose). Plain `.ts`/`.tsx` source files only, no `package.json` or
  `tsconfig.json`, so tooling can't mistake this for a separate Node module.
  The Java app is the primary artifact here; the TS files exist purely so a
  scanner bundled against this Java repo can be checked for TypeScript
  violation detection. Not every cz-ts rule needs to fire — partial coverage
  (~60%) is acceptable for this fixture's purpose.

## Maven Wrapper

`.mvn/wrapper/maven-wrapper.properties` is included, but the `mvnw` /
`mvnw.cmd` launcher scripts are not checked in here — generate them locally
with `mvn -N io.takari:maven:wrapper` or (Maven 3.9+) `mvn wrapper:wrapper`.
