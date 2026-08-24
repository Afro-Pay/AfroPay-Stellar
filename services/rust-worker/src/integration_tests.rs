//! Integration tests for [`crate::stellar::submit_transaction`] against a mocked Horizon
//! server. No real network calls are made — each test spins up its own local
//! [`wiremock::MockServer`] and points the worker at it via the `horizon_base_url`
//! argument.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

use crate::models::TransactionJob;
use crate::stellar::{submit_transaction, SubmitError, TESTNET_PASSPHRASE};

/// A funded testnet keypair used purely to exercise the signing code path; it never
/// touches the real network.
const SOURCE_SECRET: &str = "SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X";
const SOURCE_ACCOUNT: &str = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
const DESTINATION_ACCOUNT: &str = "GD6ROJBYLKQMOW3E7N4M2YBPUHMZD7PL65VRHRMO24BOVSBV5H3BQRSL";

fn sample_job() -> TransactionJob {
    TransactionJob {
        id: "integration-test-job".to_string(),
        user_id: "test-user".to_string(),
        source_wallet: SOURCE_ACCOUNT.to_string(),
        destination_wallet: DESTINATION_ACCOUNT.to_string(),
        amount: "10.0000000".to_string(),
        asset_code: "XLM".to_string(),
        asset_issuer: "".to_string(),
        memo: None,
        requires_cosign: false,
        threshold_usd: None,
    }
}

fn account_response(sequence: &str) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(json!({ "sequence": sequence }))
}

/// Responds to every `POST /transactions` call with the next `ResponseTemplate` from a
/// fixed script, so a test can simulate "fails once, then succeeds" style sequences.
struct ScriptedResponder {
    responses: Vec<ResponseTemplate>,
    calls: Arc<AtomicUsize>,
}

impl Respond for ScriptedResponder {
    fn respond(&self, _request: &Request) -> ResponseTemplate {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        self.responses
            .get(call)
            .cloned()
            .unwrap_or_else(|| self.responses.last().cloned().unwrap())
    }
}

#[tokio::test]
async fn happy_path_payment_submission_succeeds() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path(format!("/accounts/{}", SOURCE_ACCOUNT)))
        .respond_with(account_response("100"))
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/transactions"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "hash": "success-hash-123" })),
        )
        .mount(&mock_server)
        .await;

    let client = reqwest::Client::new();
    let result = submit_transaction(
        &client,
        &mock_server.uri(),
        &sample_job(),
        SOURCE_SECRET,
        TESTNET_PASSPHRASE,
    )
    .await;

    assert_eq!(result.expect("submission should succeed"), "success-hash-123");
}

#[tokio::test]
async fn tx_bad_seq_refetches_sequence_and_retries_until_success() {
    let mock_server = MockServer::start().await;
    let sequence_calls = Arc::new(AtomicUsize::new(0));
    let submit_calls = Arc::new(AtomicUsize::new(0));

    // Each call to the account endpoint hands back a fresh (incrementing) sequence
    // number, so the second attempt genuinely uses a refreshed value rather than a
    // stale cached one.
    {
        let sequence_calls = sequence_calls.clone();
        Mock::given(method("GET"))
            .and(path(format!("/accounts/{}", SOURCE_ACCOUNT)))
            .respond_with(move |_req: &Request| {
                let call = sequence_calls.fetch_add(1, Ordering::SeqCst);
                account_response(&(100 + call).to_string())
            })
            .expect(2)
            .mount(&mock_server)
            .await;
    }

    let bad_seq_response = ResponseTemplate::new(400).set_body_json(json!({
        "extras": { "result_codes": { "transaction": "tx_bad_seq", "operations": [] } }
    }));
    let success_response =
        ResponseTemplate::new(200).set_body_json(json!({ "hash": "retried-hash-456" }));

    {
        let submit_calls = submit_calls.clone();
        Mock::given(method("POST"))
            .and(path("/transactions"))
            .respond_with(ScriptedResponder {
                responses: vec![bad_seq_response, success_response],
                calls: submit_calls,
            })
            .expect(2)
            .mount(&mock_server)
            .await;
    }

    let client = reqwest::Client::new();
    let result = submit_transaction(
        &client,
        &mock_server.uri(),
        &sample_job(),
        SOURCE_SECRET,
        TESTNET_PASSPHRASE,
    )
    .await;

    assert_eq!(
        result.expect("worker should retry the bad-seq response and succeed"),
        "retried-hash-456"
    );
    assert_eq!(
        sequence_calls.load(Ordering::SeqCst),
        2,
        "sequence number should be refetched before the retry"
    );

    mock_server.verify().await;
}

#[tokio::test]
async fn tx_insufficient_balance_is_marked_permanently_failed_without_retry() {
    let mock_server = MockServer::start().await;
    let submit_calls = Arc::new(AtomicUsize::new(0));

    Mock::given(method("GET"))
        .and(path(format!("/accounts/{}", SOURCE_ACCOUNT)))
        .respond_with(account_response("100"))
        .expect(1)
        .mount(&mock_server)
        .await;

    {
        let submit_calls = submit_calls.clone();
        Mock::given(method("POST"))
            .and(path("/transactions"))
            .respond_with(move |_req: &Request| {
                submit_calls.fetch_add(1, Ordering::SeqCst);
                ResponseTemplate::new(400).set_body_json(json!({
                    "extras": {
                        "result_codes": {
                            "transaction": "tx_insufficient_balance",
                            "operations": []
                        }
                    }
                }))
            })
            .expect(1)
            .mount(&mock_server)
            .await;
    }

    let client = reqwest::Client::new();
    let result = submit_transaction(
        &client,
        &mock_server.uri(),
        &sample_job(),
        SOURCE_SECRET,
        TESTNET_PASSPHRASE,
    )
    .await;

    match result {
        Err(SubmitError::PermanentFailure(msg)) => {
            assert!(msg.contains("tx_insufficient_balance"));
        }
        other => panic!("expected a permanent failure, got: {:?}", other),
    }
    assert_eq!(
        submit_calls.load(Ordering::SeqCst),
        1,
        "the worker must not retry a permanent failure"
    );

    // `.expect(1)` on both mocks above asserts, on drop, that neither endpoint was
    // hit more than once — i.e. no retry was attempted.
    mock_server.verify().await;
}
