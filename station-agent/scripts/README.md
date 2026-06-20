# ND Station Agent - Local Helper Scripts

This directory contains shell scripts to automate starting and stopping all 8 backend services locally for development and testing.

## Files

- **`run-all.sh`**: Checks if Redis is running locally, starts a Docker container for Redis if missing, launches all 8 backend .NET services in the background, and captures their process IDs (PIDs).
- **`kill-all.sh`**: Reads the captured PIDs and terminates the background processes cleanly. If the PID log is missing, it runs a fallback process name match to stop any remaining instances.
- **`logs/`**: Folder where logs from each background service are written (e.g. `logs/job-engine.log`).

---

## How to Use

### 1. Permissions
Make sure the scripts are executable:
```bash
chmod +x run-all.sh kill-all.sh
```

### 2. Start all services
Run the startup script:
```bash
./run-all.sh
```

### 3. Monitor logs
To view the output of a specific service:
```bash
tail -f logs/job-engine.log
```
Or to watch all logs in real-time:
```bash
tail -f logs/*.log
```

### 4. Stop all services
Run the shutdown script:
```bash
./kill-all.sh
```
