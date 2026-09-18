/** 원본 Meetily의 하드코딩된 영어 문구를 렌더링된 DOM 단계에서 사전과 대조해 한국어로 치환한다. 사전에 없는 문자열(회의 제목·전사 본문 등 사용자 데이터)은 절대 변경하지 않는다. */
export type Dictionary = Record<string, string>;
export type Pattern = [RegExp, string];

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE']);
const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'aria-placeholder', 'alt'];

export function createTranslator(dictionary: Dictionary, patterns: Pattern[]) {
  return function translate(raw: string): string | null {
    if (!raw) return null;
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (trimmed.length < 2) return null;
    const hit = dictionary[trimmed];
    if (hit !== undefined) return hit === trimmed ? null : hit;
    for (const [pattern, replacement] of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(trimmed)) {
        pattern.lastIndex = 0;
        const next = trimmed.replace(pattern, replacement);
        return next === trimmed ? null : next;
      }
    }
    return null;
  };
}

function keepSpacing(raw: string, translated: string): string {
  const leading = raw.match(/^\s*/)?.[0] ?? '';
  const trailing = raw.match(/\s*$/)?.[0] ?? '';
  return leading + translated + trailing;
}

function isSkipped(node: Node): boolean {
  let current: Node | null = node.parentNode;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement;
      if (SKIP_TAGS.has(element.tagName)) return true;
      if (element.isContentEditable) return true;
      if (element.dataset && element.dataset.koSkip !== undefined) return true;
    }
    current = current.parentNode;
  }
  return false;
}

export function localizeElement(root: Node, translate: (raw: string) => string | null): void {
  if (root.nodeType === Node.TEXT_NODE) {
    localizeTextNode(root as Text, translate);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    texts.push(node as Text);
    node = walker.nextNode();
  }
  for (const text of texts) localizeTextNode(text, translate);

  if (root.nodeType === Node.ELEMENT_NODE) localizeAttributes(root as HTMLElement, translate);
  const scope = root as Element;
  const selector = ATTRIBUTES.map((name) => '[' + name + ']').join(',');
  scope.querySelectorAll?.(selector).forEach((element) => {
    localizeAttributes(element as HTMLElement, translate);
  });
}

function localizeTextNode(text: Text, translate: (raw: string) => string | null): void {
  const raw = text.data;
  if (!raw || !raw.trim()) return;
  if (isSkipped(text)) return;
  const translated = translate(raw);
  if (translated === null) return;
  text.data = keepSpacing(raw, translated);
}

export function localizeAttributes(element: HTMLElement, translate: (raw: string) => string | null): void {
  if (SKIP_TAGS.has(element.tagName) && element.tagName !== 'TEXTAREA') return;
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value || !value.trim()) continue;
    const translated = translate(value);
    if (translated === null) continue;
    element.setAttribute(name, keepSpacing(value, translated));
  }
}

export function startLocalizer(translate: (raw: string) => string | null): () => void {
  let queued = false;
  const pending = new Set<Node>();

  const flush = () => {
    queued = false;
    const targets = [...pending];
    pending.clear();
    observer.disconnect();
    try {
      for (const target of targets) {
        if (target.isConnected) localizeElement(target, translate);
      }
    } finally {
      connect();
    }
  };

  const schedule = (target: Node) => {
    pending.add(target);
    if (queued) return;
    queued = true;
    requestAnimationFrame(flush);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') {
        schedule(record.target);
      } else if (record.type === 'attributes') {
        schedule(record.target);
      } else {
        record.addedNodes.forEach((added) => schedule(added));
      }
    }
  });

  const connect = () => {
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTES,
    });
  };

  localizeElement(document.body, translate);
  connect();

  return () => observer.disconnect();
}
