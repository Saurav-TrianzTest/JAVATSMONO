# Multi-stage Dockerfile for Spring Boot Application
# Optimized for AWS ECS Fargate deployment
# Base Image: mcr.microsoft.com/openjdk/jdk:17-ubuntu (explicitly provided)

# Stage 1: Build
FROM maven:3.9.4-eclipse-temurin-17 AS builder

WORKDIR /workspace

# Copy pom.xml first for better dependency caching
COPY pom.xml .

# Download dependencies (cached layer if pom.xml hasn't changed)
RUN mvn dependency:go-offline -B

# Copy source code
COPY src ./src

# Build the application (skip tests for faster builds)
RUN mvn clean package -DskipTests -B

# Stage 2: Runtime
FROM mcr.microsoft.com/openjdk/jdk:17-ubuntu

WORKDIR /app

# Create non-root user for security
RUN groupadd -r spring -g 1001 && \
    useradd -r -g spring -u 1001 spring

# Copy the built JAR from builder stage
COPY --from=builder /workspace/target/*.jar app.jar

# Change ownership to non-root user
RUN chown spring:spring app.jar

# Switch to non-root user
USER spring

# Expose application port
EXPOSE 8080

# Set JVM options for containerized environment
ENV JAVA_OPTS="-Xmx512m -Xms256m -XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"

# Set Spring profile for Docker environment
ENV SPRING_PROFILES_ACTIVE=docker

# Run the application
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
