"""
Background Script Execution & Live Log Streaming Task Manager.
"""

import sys
import time
import uuid
import logging
import threading
import subprocess
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime

from scripts.common import BASE_DIR
from scripts.common.runner import SCRIPT_REGISTRY, resolve_script_key, get_python_executable

logger = logging.getLogger(__name__)


class TaskManager:
    """Manages asynchronous script execution, logs, and processes."""

    def __init__(self):
        self._tasks: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def list_available_scripts(self) -> List[Dict[str, Any]]:
        """Returns metadata for all runnable data pipelines."""
        scripts = []
        for key, info in SCRIPT_REGISTRY.items():
            if key == "web":
                continue  # Don't list the web server itself as a batch script
            scripts.append({
                "key": key,
                "name": info["name"],
                "description": info["description"],
                "default_args": info["default_args"],
                "schedule_cron": info["schedule_cron"],
            })
        return scripts

    def start_script(self, script_key: str, extra_args: Optional[List[str]] = None, exchanges: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Launches a registered script in the background and tracks its live output.
        `exchanges` is display-only metadata (the actual `--exchange` values, if
        any, are already baked into extra_args by the caller) - carried on the
        task record so polling clients can keep showing which exchange(s) a
        pipeline run is/was scoped to.
        """
        canonical_key = resolve_script_key(script_key)
        if not canonical_key or canonical_key not in SCRIPT_REGISTRY:
            raise ValueError(f"Unknown script: '{script_key}'")

        script_info = SCRIPT_REGISTRY[canonical_key]
        script_path = script_info["script_path"]

        if not script_path.exists():
            raise FileNotFoundError(f"Script file not found: {script_path}")

        python_bin = get_python_executable()
        cmd = [python_bin, str(script_path)]
        if extra_args:
            cmd.extend(extra_args)

        task_id = str(uuid.uuid4())[:8]
        start_time = datetime.now().isoformat()

        task_record = {
            "task_id": task_id,
            "script_key": canonical_key,
            "script_name": script_info["name"],
            "command": " ".join(cmd),
            "args": extra_args or [],
            "exchanges": exchanges,
            "status": "RUNNING",  # RUNNING, SUCCESS, FAILED, STOPPED
            "start_time": start_time,
            "end_time": None,
            "exit_code": None,
            "logs": [],
            "_process": None,
        }

        with self._lock:
            self._tasks[task_id] = task_record

        # Spawn execution in background thread
        thread = threading.Thread(
            target=self._run_process,
            args=(task_id, cmd),
            daemon=True
        )
        thread.start()

        return {
            "task_id": task_id,
            "script_key": canonical_key,
            "script_name": script_info["name"],
            "exchanges": exchanges,
            "status": "RUNNING",
            "start_time": start_time,
        }

    def _run_process(self, task_id: str, cmd: List[str]):
        """Worker thread to execute subprocess and stream stdout/stderr line by line."""
        try:
            process = subprocess.Popen(
                cmd,
                cwd=str(BASE_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
            )

            with self._lock:
                if task_id in self._tasks:
                    self._tasks[task_id]["_process"] = process

            # Stream logs line by line
            for line in iter(process.stdout.readline, ""):
                clean_line = line.rstrip("\r\n")
                if clean_line:
                    with self._lock:
                        if task_id in self._tasks:
                            self._tasks[task_id]["logs"].append({
                                "time": datetime.now().strftime("%H:%M:%S"),
                                "text": clean_line,
                            })

            process.stdout.close()
            return_code = process.wait()

            with self._lock:
                if task_id in self._tasks:
                    self._tasks[task_id]["exit_code"] = return_code
                    self._tasks[task_id]["end_time"] = datetime.now().isoformat()
                    self._tasks[task_id]["status"] = "SUCCESS" if return_code == 0 else "FAILED"
                    self._tasks[task_id]["_process"] = None

        except Exception as e:
            logger.error(f"Error running task {task_id}: {e}", exc_info=True)
            with self._lock:
                if task_id in self._tasks:
                    self._tasks[task_id]["status"] = "FAILED"
                    self._tasks[task_id]["end_time"] = datetime.now().isoformat()
                    self._tasks[task_id]["logs"].append({
                        "time": datetime.now().strftime("%H:%M:%S"),
                        "text": f"[Task Manager Error] {str(e)}"
                    })
                    self._tasks[task_id]["_process"] = None

    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Returns details and logs of a specific task."""
        with self._lock:
            if task_id not in self._tasks:
                return None
            t = self._tasks[task_id]
            return {
                "task_id": t["task_id"],
                "script_key": t["script_key"],
                "script_name": t["script_name"],
                "command": t["command"],
                "exchanges": t.get("exchanges"),
                "status": t["status"],
                "start_time": t["start_time"],
                "end_time": t["end_time"],
                "exit_code": t["exit_code"],
                "logs": t["logs"],
            }

    def list_recent_tasks(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Returns list of recent tasks with brief status."""
        with self._lock:
            sorted_tasks = sorted(
                self._tasks.values(),
                key=lambda x: x["start_time"],
                reverse=True
            )
            return [
                {
                    "task_id": t["task_id"],
                    "script_key": t["script_key"],
                    "script_name": t["script_name"],
                    "exchanges": t.get("exchanges"),
                    "status": t["status"],
                    "start_time": t["start_time"],
                    "end_time": t["end_time"],
                    "exit_code": t["exit_code"],
                    "log_count": len(t["logs"]),
                }
                for t in sorted_tasks[:limit]
            ]

    def stop_task(self, task_id: str) -> bool:
        """Terminates a running process."""
        with self._lock:
            if task_id not in self._tasks:
                return False
            t = self._tasks[task_id]
            process = t.get("_process")
            if process and process.poll() is None:
                process.terminate()
                t["status"] = "STOPPED"
                t["end_time"] = datetime.now().isoformat()
                t["logs"].append({
                    "time": datetime.now().strftime("%H:%M:%S"),
                    "text": "[Task Stopped by User]"
                })
                return True
            return False


# Global singleton task manager
task_manager = TaskManager()
