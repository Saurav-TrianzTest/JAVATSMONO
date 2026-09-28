# =============================================================================
# Multi-Stage Dockerfile — storefront-backend (Spring Boot 3.2.5 / Java 17)
# Build Tool : Maven (system mvn — wrapper files excluded)
# Runtime    : amazoncorretto:17 (explicit base image)
# Target     : AWS ECS Fargate
# =============================================================================

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM maven:3.9.4-eclipse-temurin-17 AS builder

WORKDIR /workspace

# Copy build descriptor first for dependency-layer caching
COPY pom.xml ./

# Pre-download all dependencies (cached unless pom.xml changes)
RUN mvn dependency:go-offline -B --no-transfer-progress

# Copy application source code
COPY src/ ./src/

# Build the executable JAR (skip tests — tests run in CI pipeline)
RUN mvn clean package -DskipTests -B --no-transfer-progress

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM amazoncorretto:17

# Security: run as non-root user
RUN groupadd -r appgroup && useradd -r -g appgroup -s /sbin/nologin appuser

WORKDIR /app

# Copy only the executable fat-JAR from the builder stage
COPY --from=builder /workspace/target/*.jar app.jar

# Transfer ownership to non-root user
RUN chown appuser:appgroup app.jar

USER appuser

# Expose application port (matches server.port=8080 in application.properties)
EXPOSE 8080

# JVM tuning for containerised workloads:
#   UseContainerSupport  — honours cgroup CPU/memory limits
#   MaxRAMPercentage     — caps heap at 75 % of container memory
#   Xms256m              — initial heap to reduce startup latency
#   security.egd         — faster SecureRandom seeding in containers
ENV JAVA_OPTS="-XX:+UseContainerSupport \
               -XX:MaxRAMPercentage=75.0 \
               -Xms256m \
               -Djava.security.egd=file:/dev/./urandom \
               -Dfile.encoding=UTF-8 \
               -Duser.timezone=UTC" \
    SPRING_PROFILES_ACTIVE=docker \
    SERVER_PORT=8080 \
    TZ=UTC

# Graceful shutdown: Spring Boot listens for SIGTERM
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
