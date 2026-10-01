use super::stream::StreamDecoder;
#[test]
fn stream_record_chatgpt_completed_stream_accepts_split_utf8_and_crlf() {
    // Given Korean text and a terminal completion. When bytes arrive split arbitrarily. Then retain exact text.
    let source="data: {\"type\":\"response.output_text.delta\",\"delta\":\"안녕\"}\r\n\r\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\r\n\r\n";
    let mut parser = StreamDecoder::default();
    for byte in source.as_bytes() {
        parser.push(&[*byte]).unwrap();
    }
    assert_eq!(parser.finish().unwrap(), "안녕");
}
#[test]
fn stream_record_chatgpt_interrupted_stream_never_returns_partial_text() {
    // Given a delta without terminal completion. When stream ends. Then reject.
    let mut parser = StreamDecoder::default();
    parser
        .push(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
        .unwrap();
    assert!(parser.finish().is_err());
}
#[test]
fn stream_record_chatgpt_usage_failure_after_delta_never_returns_partial_text() {
    // Given partial output. When the server reports a usage error. Then preserve the code and fail.
    let mut parser = StreamDecoder::default();
    parser
        .push(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
        .unwrap();
    let result=parser.push(b"data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}}\n\n");
    assert!(result
        .unwrap_err()
        .contains("subscription_sharing_usage_limit_exceeded"));
}

#[test]
fn stream_record_chatgpt_mixed_line_endings_preserve_event_order() {
    // Given mixed newline forms in one network chunk. When decoding. Then consume the earliest boundary first.
    let mut parser = StreamDecoder::default();
    parser.push(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\r\n\r\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n").unwrap();
    assert_eq!(parser.finish().unwrap(), "ok");
}
