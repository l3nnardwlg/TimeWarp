
use serde::Serialize;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::{env, net::TcpListener, path::Path, thread, time::Duration};
use tauri::{Manager, State};
use uuid::Uuid;

#[derive(Default)]
struct BackendState {
    child: Mutex<Option<Child>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Connection {
    port: u16,
    token: String,
}

#[tauri::command]
fn launch_timewarp(project_path: String, state: State<'_, BackendState>) -> Result<Connection, String> {
    let project = Path::new(&project_path)
        .canonicalize()
        .map_err(|e| format!("Project directory is not accessible: {e}"))?;
    if !project.is_dir() {
        return Err("Choose a project directory, not a file.".into());
    }
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.as_mut() {
        if existing.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Err("TimeWarp is already connected. Restart the app to select a new project.".into());
        }
        *guard = None;
    }
    // Ask the OS for a free loopback port. The CLI never listens on a public interface.
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let external = env::var("TIMEWARP_CLI_PATH").ok();
    let mut command = if let Some(script) = external {
        let mut cmd = Command::new("node");
        cmd.arg(script);
        cmd
    } else {
        Command::new(if cfg!(windows) { "timewarp.cmd" } else { "timewarp" })
    };
    let child = command
        .arg("ui")
        .arg("--project")
        .arg(&project)
        .arg("--port")
        .arg(port.to_string())
        .arg("--no-browser")
        .current_dir(&project)
        .env("TIMEWARP_DASHBOARD_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Could not start the TimeWarp CLI. Install it first. Details: {e}"))?;
    *guard = Some(child);
    thread::sleep(Duration::from_millis(400));
    if let Some(process) = guard.as_mut() {
        if let Some(status) = process.try_wait().map_err(|e| e.to_string())? {
            *guard = None;
            return Err(format!("TimeWarp CLI exited early ({status}). Initialize the project with 'timewarp init'."));
        }
    }
    Ok(Connection { port, token })
}

pub fn run() {
    tauri::Builder::default()
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![launch_timewarp])
        .build(tauri::generate_context!())
        .expect("error while building TimeWarp desktop")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Ok(mut guard) = app.state::<BackendState>().child.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}
