/** Independent builds never install updates from the upstream Meetily channel. */
export function automaticUpdatesEnabled(): boolean {
  // Enable only after a Stream-Record-specific signed update channel is implemented and tested.
  return false;
}
export const UPDATE_DISABLED_MESSAGE = 'Stream-Record 독립 배포본은 자동 업데이트를 사용하지 않습니다. 별도 Stream-Record 배포본을 확인하세요.';
