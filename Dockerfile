# =============================================================================
# Stage 1 – TypeScript Type-Check Gate
# Enforces strict TypeScript compilation before any Java image layer is built.
# Weakly-typed Context (createContext<any>) will cause tsc to fail here,
# preventing the image from being pushed to ECR and deployed as a Fargate task.
# =============================================================================
FROM node:20-alpine AS ts-typecheck

WORKDIR /app

# Copy only the files needed for type-checking
COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY ts-frontend/ ./ts-frontend/

# Type-check gate: fails the build if any TypeScript type errors are found.
RUN npx tsc --noEmit

# =============================================================================
# Stage 2 – Java / Spring Boot Build
# Only reached if the TypeScript type-check gate above passes.
# =============================================================================
FROM maven:3.9.4-eclipse-temurin-17 AS builder

WORKDIR /workspace

# Copy pom.xml first for dependency layer caching
COPY pom.xml ./
RUN mvn dependency:go-offline -B

# Copy source code and build
COPY src/ ./src/
RUN mvn clean package -DskipTests -B

# =============================================================================
# Stage 3 – Runtime Image
# Uses the explicit base image: mcr.microsoft.com/openjdk/jdk:17-ubuntu
# Minimal runtime; no build tools, no TypeScript sources.
# =============================================================================
FROM mcr.microsoft.com/openjdk/jdk:17-ubuntu AS runtime

WORKDIR /app

# Create non-root user for container security
RUN groupadd -r appgroup && useradd -r -g appgroup -s /bin/false appuser

# Set timezone
ENV TZ=UTC

# JVM tuning for containerized environments
ENV JAVA_OPTS="-Xmx512m -Xms256m -XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -XX:+UnlockExperimentalVMOptions -Djava.security.egd=file:/dev/./urandom"

# Spring profile
ENV SPRING_PROFILES_ACTIVE=docker

# Copy only the compiled Spring Boot JAR from the builder stage
COPY --from=builder /workspace/target/*.jar app.jar

# Switch to non-root user
USER appuser

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
