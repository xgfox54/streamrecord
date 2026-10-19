use std::sync::{LazyLock, Mutex};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

struct Session {
    cancellation: CancellationToken,
    workers: TaskTracker,
}

impl Session {
    fn new() -> Self { Self { cancellation: CancellationToken::new(), workers: TaskTracker::new() } }
}

static SESSION: LazyLock<Mutex<Session>> = LazyLock::new(|| Mutex::new(Session::new()));

pub(super) fn begin() {
    *SESSION.lock().unwrap_or_else(|error| error.into_inner()) = Session::new();
}

pub(crate) fn current() -> CancellationToken {
    SESSION.lock().unwrap_or_else(|error| error.into_inner()).cancellation.clone()
}

pub(super) fn workers() -> TaskTracker {
    SESSION.lock().unwrap_or_else(|error| error.into_inner()).workers.clone()
}

pub(crate) async fn run<T>(
    cancellation: &CancellationToken,
    work: impl std::future::Future<Output = T>,
) -> Option<T> {
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => None,
        result = work => Some(result),
    }
}

/// Owns a task while it is awaited so cancellation cannot detach it.
pub(super) struct OwnedTask<T>(pub JoinHandle<T>);

impl<T> Drop for OwnedTask<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    #[tokio::test]
    async fn cancellation_drops_work_and_aborts_nested_workers() {
        let cancellation = CancellationToken::new();
        let (started, ready) = tokio::sync::oneshot::channel();
        let (finished, stopped) = tokio::sync::oneshot::channel::<()>();
        let worker = OwnedTask(tokio::spawn(async move {
            let mut children = tokio::task::JoinSet::new();
            children.spawn(async move {
                let _finished = finished;
                started.send(()).unwrap();
                std::future::pending::<()>().await;
            });
            children.join_next().await;
        }));
        ready.await.unwrap();
        cancellation.cancel();
        let outcome = run(&cancellation, async move {
            let mut worker = worker;
            (&mut worker.0).await.unwrap();
        }).await;
        assert!(outcome.is_none());
        assert!(tokio::time::timeout(Duration::from_secs(1), stopped).await.unwrap().is_err());
    }

    #[tokio::test]
    async fn completed_work_is_returned_and_a_cancelled_session_cannot_poll_more_work() {
        let cancellation = CancellationToken::new();
        assert_eq!(run(&cancellation, async { 7 }).await, Some(7));
        cancellation.cancel();
        let polled = Arc::new(AtomicBool::new(false));
        let started = Arc::clone(&polled);
        assert_eq!(run(&cancellation, async move {
            started.store(true, Ordering::SeqCst);
            9
        }).await, None);
        assert!(!polled.load(Ordering::SeqCst));
        assert_eq!(run(&CancellationToken::new(), async { 11 }).await, Some(11));
    }
}
