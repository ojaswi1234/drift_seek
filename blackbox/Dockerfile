# Blackbox Exporter for DriftSeeker Monitoring
# Based on prom/blackbox-exporter with custom configuration

FROM prom/blackbox-exporter:v0.25.0

# Copy custom configuration
COPY blackbox.yml /etc/blackbox_exporter/config.yml

# Expose the Blackbox Exporter port
EXPOSE 9115

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9115/health || exit 1

# Run as non-root user (default in prom/blackbox-exporter)
USER nobody

# Entry point with config file - REQUIRED for the exporter to start properly
CMD ["--config.file=/etc/blackbox_exporter/config.yml"]