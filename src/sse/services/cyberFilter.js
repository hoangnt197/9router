import { v4 as uuidv4 } from "uuid";

const REFUSAL_MESSAGE =
  "Tôi rất tiếc nhưng không thể hỗ trợ thực hiện yêu cầu này vì lý do an toàn và bảo mật thông tin. Nếu bạn quan tâm, tôi có thể hỗ trợ cung cấp các kiến thức về an toàn thông tin hoặc các giải pháp bảo mật phòng thủ hợp pháp.";

const WINDOW = 96;
const HARMFUL = "malware|ransomware|keylogger|trojans?|spyware|botnets?|rootkits?|phishing";

const DEFENSIVE = new RegExp(
  `\\b(?:${HARMFUL})\\s+(?:detection|detector|scanners?|signatures?|removal|recovery|mitigation|prevention|quarantine)\\b` +
  `|\\b(?:detect(?:s|ing)?|prevent(?:s|ing)?|remov(?:e|es|ing|al\\s+of)|mitigat(?:e|es|ing)|quarantin(?:e|es|ing))\\s+(?:${HARMFUL})\\b`,
  "i"
);

const HARMFUL_OCCURRENCE = new RegExp(`\\b(?:${HARMFUL})\\b`, "gi");

function near(left, right) {
  return new RegExp(
    `(?:${left})[\\s\\S]{0,${WINDOW}}?(?:${right})|(?:${right})[\\s\\S]{0,${WINDOW}}?(?:${left})`,
    "i"
  );
}

const RULES = [
  {
    name: "unauthorized_access",
    pattern: new RegExp(
      "\\b(?:how\\s+to|steps?\\s+to|guide\\s+(?:me\\s+)?to|script\\s+to|instructions?\\s+(?:to|for)|" +
      "huong\\s*dan|chi\\s*(?:toi|em|minh)|cach\\s+(?:de|truy\\s*cap|xam\\s*nhap))\\b[\\s\\S]{0,160}?" +
      "\\b(?:gain\\s+access|break\\s+into|take\\s+over|hack|compromise|truy\\s*cap|xam\\s*nhap|chiem\\s*quyen)\\b[\\s\\S]{0,160}?" +
      "\\b(?:without\\s+(?:permission|authorization)|unauthori[sz]ed|trai\\s*phep|khong\\s*(?:co\\s*)?quyen|khong\\s*duoc\\s*phep)\\b",
      "i"
    ),
  },
  {
    name: "credential_theft",
    pattern: near(
      "\\b(?:steal|exfiltrate|harvest|dump|phish|danh\\s*cap|trich\\s*xuat)\\b",
      "\\b(?:credentials?|passwords?|api[ _-]?keys?|tokens?|sessions?|mat\\s*khau|thong\\s*tin\\s*dang\\s*nhap|api[ _-]?key|token)\\b"
    ),
  },
  {
    name: "malware_creation",
    pattern: near(
      "\\b(?:create|build|write|deploy|spread|infect|distribute|craft|tao|viet|trien\\s*khai)\\b",
      `\\b(?:${HARMFUL}|ma\\s*doc)\\b`
    ),
  },
  {
    name: "exploit_development",
    pattern: near(
      "\\b(?:create|build|write|develop|generate|craft|tao|viet|xay\\s*dung)\\b",
      "\\b(?:exploits?|exploit\\s*poc|poc\\s*exploit|attack\\s+tools?|weaponi[sz]e|cong\\s*cu\\s*tan\\s*cong|ma\\s*tan\\s*cong)\\b"
    ),
  },
  {
    name: "phishing_kit",
    pattern: new RegExp(
      "\\b(?:create|build|write|craft|clone|host|deploy)\\b[\\s\\S]{0,96}?" +
      "\\b(?:phishing\\s+(?:kit|page|site|email|campaign)|spear[- ]?phish(?:ing)?|credential[- ]?harvest(?:ing)?)\\b",
      "i"
    ),
  },
  {
    name: "security_bypass",
    pattern: near(
      "\\b(?:bypass|evade)\\b",
      "\\b(?:authentication|security\\s+controls?|antivirus|edr|monitoring|detection|xac\\s*thuc|giam\\s*sat)\\b"
    ),
  },
  {
    name: "security_bypass",
    pattern: near(
      "\\b(?:disable|turn\\s+off|tat|vo\\s*hieu\\s*hoa)\\b",
      "\\b(?:authentication|security\\s+controls?|monitoring|detection)\\b"
    ),
  },
  {
    name: "attack_automation",
    pattern: near(
      "\\b(?:automat(?:e|ing|ion)|script(?:ing)?|tu\\s*dong\\s*hoa)\\b",
      "\\b(?:attacks?|attacking|exploits?|exploitation|bruteforce|brute[- ]force|credential\\s+stuffing|tan\\s*cong)\\b"
    ),
  },
  {
    name: "attack_automation",
    pattern: new RegExp(
      "\\b(?:scan(?:ning)?\\s+and\\s+attack|attack\\s+these\\s+hosts|mass[- ]?(?:scan|attack)|quet\\s+lo\\s+hong[\\s\\S]{0,96}tan\\s*cong)\\b",
      "i"
    ),
  },
];

export function normalizeText(value) {
  if (!value || typeof value !== "string") return "";
  let v = value.normalize("NFKC").toLowerCase();
  v = v.replace(/[\u200B\u200C\u200D]/g, "");
  v = v.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  v = v.replace(/đ/g, "d");
  return v.replace(/\s+/g, " ").trim();
}

function collectTextValues(val, out = []) {
  if (typeof val === "string") {
    out.push(val);
  } else if (Array.isArray(val)) {
    for (const item of val) collectTextValues(item, out);
  } else if (val && typeof val === "object") {
    for (const key of ["content", "input", "text", "arguments"]) {
      if (val[key]) collectTextValues(val[key], out);
    }
  }
  return out;
}

function getLatestUserText(body) {
  if (!body || typeof body !== "object") return "";
  const parts = [];

  if (Array.isArray(body.messages)) {
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const msg = body.messages[i];
      if (msg && msg.role === "user") {
        for (const key of ["content", "input", "text"]) {
          if (msg[key]) parts.push(...collectTextValues(msg[key]));
        }
        break;
      }
    }
  }

  if (typeof body.input === "string") {
    parts.push(body.input);
  } else if (Array.isArray(body.input)) {
    for (let i = body.input.length - 1; i >= 0; i--) {
      const item = body.input[i];
      if (item && item.role === "user") {
        parts.push(...collectTextValues(item));
        break;
      } else if (typeof item === "string") {
        parts.push(item);
        break;
      }
    }
  }

  if (typeof body.prompt === "string") {
    parts.push(body.prompt);
  }

  return parts.join("\n");
}

/**
 * Check if the request body triggers any cyber abuse blocking rules.
 * @param {Object} body
 * @returns {string|null} Rule name if blocked, null otherwise.
 */
export function checkBlockingRule(body) {
  const rawText = getLatestUserText(body);
  if (!rawText) return null;
  const normalized = normalizeText(rawText);
  if (!normalized) return null;

  // Check defensive compounds
  const compounds = [];
  let m;
  const defRegex = new RegExp(DEFENSIVE.source, "gi");
  while ((m = defRegex.exec(normalized)) !== null) {
    compounds.push({ start: m.index, end: m.index + m[0].length });
  }

  const harmfulOccurrences = [];
  const harmRegex = new RegExp(HARMFUL_OCCURRENCE.source, "gi");
  while ((m = harmRegex.exec(normalized)) !== null) {
    harmfulOccurrences.push({ start: m.index, end: m.index + m[0].length });
  }

  const defensiveOnly =
    compounds.length > 0 &&
    harmfulOccurrences.every((noun) =>
      compounds.some((c) => c.start <= noun.start && c.end >= noun.end)
    );

  for (const { name, pattern } of RULES) {
    const match = pattern.exec(normalized);
    if (match) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      const overlapsDefensive = compounds.some(
        (c) => c.start < matchEnd && c.end > matchStart
      );
      if (defensiveOnly && overlapsDefensive) {
        continue;
      }
      return name;
    }
  }
  return null;
}

/**
 * Create an OpenAI-compatible / Claude-compatible 200 OK blocked response.
 * @param {Object} body
 * @param {string} rule
 * @param {string} endpoint
 * @param {string} sourceIp
 * @returns {Response}
 */
export function createBlockedResponse(body, rule, endpoint = "/v1/chat/completions", sourceIp = "") {
  const model = body?.model || "gpt-4o";
  const ident = uuidv4().replace(/-/g, "").slice(0, 24);
  const now = Math.floor(Date.now() / 1000);
  const isClaude = endpoint.includes("/messages");
  const isResponses = endpoint.includes("/responses");

  // Masked preview for audit log
  let preview = getLatestUserText(body).replace(/\s+/g, " ").trim();
  preview = preview.replace(/\b(?:sk|key|token|api[_ -]?key|bearer)[-_a-z0-9.]{8,}\b/gi, "[REDACTED]");
  preview = preview.replace(/\b(?:authorization\s*[:=]?\s*bearer\s+)[^\s,;]+/gi, "authorization: [REDACTED]");
  if (preview.length > 240) preview = preview.slice(0, 240) + "…";

  const logEvent = {
    event: "cyber_filter_blocked",
    time: new Date().toISOString(),
    request_id: uuidv4().replace(/-/g, ""),
    rule,
    endpoint,
    model,
    source_ip: sourceIp,
    preview,
  };
  console.warn(`[cyber-filter-blocked] ${JSON.stringify(logEvent)}`);

  let payload;
  if (isClaude) {
    payload = {
      id: "msg_" + ident,
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: REFUSAL_MESSAGE }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 24, output_tokens: 28 },
      shortlab_cyber_abuse: { blocked: true, rule, upstream_called: false },
    };
  } else if (isResponses) {
    payload = {
      id: "resp_" + ident,
      object: "response",
      created_at: now,
      status: "completed",
      model,
      output: [
        {
          type: "message",
          id: "msg_" + ident,
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", annotations: [], text: REFUSAL_MESSAGE }],
        },
      ],
      usage: {
        input_tokens: 24,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 28,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 52,
      },
      metadata: { shortlab_cyber_abuse: { blocked: true, rule, upstream_called: false } },
    };
  } else {
    payload = {
      id: "chatcmpl-" + ident,
      object: "chat.completion",
      created: now,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: REFUSAL_MESSAGE },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 24, completion_tokens: 28, total_tokens: 52 },
      shortlab_cyber_abuse: { blocked: true, rule, upstream_called: false },
    };
  }

  // A JSON response on a streaming endpoint makes OpenAI/Claude clients wait
  // for SSE framing and eventually report a parser error or timeout. Return a
  // small protocol-native refusal stream instead.
  if (body?.stream === true) {
    let streamBody;
    if (isClaude) {
      const messageStart = { ...payload, content: [] };
      streamBody = [
        `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: messageStart })}\n\n`,
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: REFUSAL_MESSAGE } })}\n\n`,
        `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: payload.usage })}\n\n`,
        "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
      ].join("");
    } else if (isResponses) {
      streamBody = `event: response.completed\ndata: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
    } else {
      const chunk = {
        id: payload.id,
        object: "chat.completion.chunk",
        created: payload.created,
        model: payload.model,
        choices: [{ index: 0, delta: { role: "assistant", content: REFUSAL_MESSAGE }, finish_reason: null }],
      };
      const terminal = {
        id: payload.id,
        object: "chat.completion.chunk",
        created: payload.created,
        model: payload.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: payload.usage,
      };
      streamBody = `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(terminal)}\n\ndata: [DONE]\n\n`;
    }
    return new Response(streamBody, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Shortlab-Cyber-Filter": "blocked",
      },
    });
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Shortlab-Cyber-Filter": "blocked",
    },
  });
}
