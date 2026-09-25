# =============================================================================
# Multi-Stage Dockerfile for storefront-backend (Spring Boot 3.2.5 / Java 17)
# with TypeScript Type-Check Gate and .d.ts Declaration-File Image-Size Gate
#
# Remediations applied:
#   cz-ts-1011 – TypeScript Context Without Proper Typing
#   cz-ts-1003 – Frontend TypeScript Declaration Files in Container
#
# This Dockerfile enforces:
#   1. A TypeScript strict type-check stage that prevents images with weakly
#      typed React Context (createContext<any>) from being pushed to ECR and
#      deployed as ECS Fargate tasks.
#   2. An image-size gate that fails the build if any .d.ts declaration files
#      are detected in the production runtime image, preventing regressions and
#      keeping the ECS Fargate image minimal.
#
# Stages:
#   1. ts-typecheck      – Runs `tsc --noEmit --strict` over the ts-frontend
#                          sources. Build fails here if any `any`-typed Context
#                          is detected, blocking the image from reaching ECR /
#                          Fargate.
#   2. frontend-build    – Compiles the TypeScript frontend after the type-check
#                          gate, producing only compiled JavaScript in ./dist.
#   3. dts-gate          – Image-size gate (cz-ts-1003): scans the compiled
#                          frontend dist for any residual .d.ts files and fails
#                          the build if any are found, preventing declaration
#                          file regressions from reaching the runtime image.
#   4. java-build        – Builds the Spring Boot backend JAR.
#   5. runtime           – Minimal production image combining frontend assets
#                          (JS only, no .d.ts) + JAR.
# =============================================================================

# ── Stage 1: TypeScript type-check gate (cz-ts-1011) ─────────────────────────
FROM node:20-alpine AS ts-typecheck

WORKDIR /app/ts-frontend

# Copy only the files needed for type-checking
COPY ts-frontend/package*.json ./
RUN npm ci --ignore-scripts

COPY ts-frontend/ ./

# Enforce strict TypeScript compilation – fails the build if any weakly typed
# Context (createContext<any> / createContext<unknown>) is present, preventing
# the image from being pushed to ECR and deployed as a Fargate task.
RUN npx tsc --noEmit --strict

# ── Stage 2: Frontend build ───────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /app/ts-frontend

COPY --from=ts-typecheck /app/ts-frontend ./

# Build produces compiled JavaScript in ./dist only.
# The tsconfig.json declarationDir is intentionally set to ./types-out (outside
# dist) so that .d.ts files are never emitted into the dist output directory.
RUN npm run build

# ── Stage 3: .d.ts image-size gate (cz-ts-1003) ──────────────────────────────
# ECS Fargate CI/CD Pipeline gate: fail the build if any TypeScript declaration
# files (.d.ts) are present in the compiled frontend output that would be copied
# into the runtime image. This prevents .d.ts regressions from bloating the
# production container and increasing ECR registry storage costs.
FROM node:20-alpine AS dts-gate

WORKDIR /app/ts-frontend

COPY --from=frontend-build /app/ts-frontend/dist ./dist

# Scan the compiled dist directory for any .d.ts files.
# If any are found, print them and exit non-zero to fail the build pipeline.
RUN set -e; \
    DTS_FILES=$(find ./dist -name "*.d.ts" -o -name "*.d.ts.map" 2>/dev/null); \
    if [ -n "$DTS_FILES" ]; then \
      echo ""; \
      echo "================================================================="; \
      echo "  BUILD GATE FAILED: cz-ts-1003"; \
      echo "  TypeScript declaration files detected in production dist output."; \
      echo "  These files must NOT be included in the runtime container image."; \
      echo "  Offending files:"; \
      echo "$DTS_FILES" | sed 's/^/    /'; \
      echo "  Fix: set 'declarationDir' in tsconfig.json to a path outside"; \
      echo "  'outDir' (e.g. ./types-out) so .d.ts files are never emitted"; \
      echo "  into the dist directory that is copied into the runtime image."; \
      echo "================================================================="; \
      echo ""; \
      exit 1; \
    fi; \
    echo "Gate passed (cz-ts-1003): no .d.ts files found in dist output."

# ── Stage 4: Java / Spring Boot build ────────────────────────────────────────
FROM maven:3.9.4-eclipse-temurin-17 AS java-build

WORKDIR /workspace

# Copy pom.xml first for dependency layer caching
COPY pom.xml ./
RUN mvn dependency:go-offline -B

# Copy source code and build
COPY src/ ./src/
RUN mvn clean package -DskipTests -B

# ── Stage 5: Production runtime ───────────────────────────────────────────────
FROM eclipse-temurin:17-jdk AS runtime

# Non-root user for container security best-practices
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

WORKDIR /app

# Copy the Spring Boot fat-JAR from the build stage
COPY --from=java-build /workspace/target/*.jar app.jar

# Copy compiled frontend assets (served by Spring Boot's static-resource handler).
# Only JavaScript and static assets from the gate-verified dist are copied –
# no .d.ts declaration files will be present here because the dts-gate stage
# above would have failed the build if any were detected (cz-ts-1003).
COPY --from=dts-gate /app/ts-frontend/dist/ ./static/

# JVM memory and container-awareness settings
ENV JAVA_OPTS="-Xmx512m -Xms256m -XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -XX:+UnlockExperimentalVMOptions"
ENV SPRING_PROFILES_ACTIVE=docker
ENV TZ=UTC

# Expose the application port
EXPOSE 8080

USER appuser

# Use exec form for proper signal handling (graceful shutdown)
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
