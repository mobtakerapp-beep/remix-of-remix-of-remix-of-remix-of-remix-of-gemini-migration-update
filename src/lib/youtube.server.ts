/**
 * Server-only helpers to pull a transcript from a YouTube video.
 * Throws: youtube_invalid_url, youtube_no_captions, openai_quota, openai_invalid_key.
 */

import { parseYoutubeId } from "./youtube-url";

export { parseYoutubeId };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&#34;|&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));
}

type CaptionTrack = {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string };
};

type AudioFormat = {
  mimeType?: string;
  bitrate?: number;
  contentLength?: string;
  url?: string;
};

type InnertubePlayer = {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string; lengthSeconds?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
  streamingData?: {
    adaptiveFormats?: AudioFormat[];
  };
};

function extractJson<T>(html: string, key: string): T | null {
  const idx = html.indexOf(key);
  if (idx === -1) return null;
  // find the start of the value (array or object) after the key
  let i = html.indexOf(":", idx + key.length);
  if (i === -1) return null;
  i += 1;
  while (i < html.length && /\s/.test(html[i]!)) i++;
  const open = html[i];
  if (open !== "[" && open !== "{") return null;
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < html.length; j++) {
    const ch = html[j]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(i, j + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseCaptionXml(xml: string): string {
  // YouTube serves either srv1 (<text>) or srv3 (<p>/<s>) markup.
  const nodes = [
    ...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g),
    ...xml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g),
  ];
  return nodes
    .map((m) => decodeEntities((m[1] ?? "").replace(/<[^>]+>/g, "")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchTrackText(baseUrl: string): Promise<string> {
  // Strip any existing fmt so our own format request wins.
  const url = baseUrl.replace(/&amp;/g, "&").replace(/([?&])fmt=[^&]*/g, "$1");

  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}fmt=json3`, { headers: { "User-Agent": UA } });
  if (res.ok) {
    const body = await res.text();
    try {
      const json = JSON.parse(body) as {
        events?: { segs?: { utf8?: string }[] }[];
      };
      const text = (json.events ?? [])
        .flatMap((e) => (e.segs ?? []).map((s) => s.utf8 ?? ""))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (text) return text;
    } catch {
      // Not JSON — YouTube returned XML instead; parse it directly.
      const text = parseCaptionXml(body);
      if (text) return text;
    }
  }
  const xmlRes = await fetch(url, { headers: { "User-Agent": UA } });
  if (!xmlRes.ok) return "";
  return parseCaptionXml(await xmlRes.text());

}

const INNERTUBE_CLIENTS = [
  {
    key: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
    context: {
      client: {
        clientName: "WEB_EMBEDDED_PLAYER",
        clientVersion: "1.20250826.00.00",
        clientScreen: "EMBED",
        hl: "en",
      },
      thirdParty: { embedUrl: "https://www.youtube.com/" },
    },
    ua: UA,
  },
  {
    key: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
    context: {
      client: {
        clientName: "ANDROID",
        clientVersion: "20.10.38",
        androidSdkVersion: 35,
        hl: "en",
      },
    },
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 15) gzip",
  },
  {
    key: "AIzaSyB-8OLtTu4pDhQ2bK7ClB6KB_xVvM7X0xY",
    context: {
      client: {
        clientName: "IOS",
        clientVersion: "20.10.4",
        deviceModel: "iPhone16,2",
        hl: "en",
      },
    },
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3 like Mac OS X)",
  },
] as const;

async function callInnertube(videoId: string) {
  let bestResponse: InnertubePlayer | null = null;
  for (const c of INNERTUBE_CLIENTS) {
    try {
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${c.key}&prettyPrint=false`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": c.ua },
          body: JSON.stringify({ videoId, context: c.context }),
        },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as InnertubePlayer;
      if (!bestResponse) bestResponse = json;
      const hasCaptions = Boolean(
        json.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length,
      );
      const hasDirectAudio = Boolean(
        json.streamingData?.adaptiveFormats?.some(
          (format) => format.mimeType?.startsWith("audio/") && format.url,
        ),
      );
      if (hasCaptions || hasDirectAudio) return json;
    } catch {
      /* try next client */
    }
  }
  return bestResponse;
}

/** Ask YouTube's internal player API for caption tracks (works when the watch HTML has none). */
async function fetchInnertube(
  videoId: string,
): Promise<{ title: string; tracks: CaptionTrack[] } | null> {
  const json = await callInnertube(videoId);
  if (!json) return null;
  const tracks =
    json.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) return null;
  return { title: json.videoDetails?.title ?? "", tracks };
}

// OpenAI transcription upload limit is 25MB.
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;

function audioFileDetails(mimeType: string | undefined) {
  const normalized = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  if (normalized === "audio/webm") return { mime: "audio/webm", name: "youtube-audio.webm" };
  if (normalized === "audio/mpeg") return { mime: "audio/mpeg", name: "youtube-audio.mp3" };
  if (normalized === "audio/wav") return { mime: "audio/wav", name: "youtube-audio.wav" };
  return { mime: "audio/mp4", name: "youtube-audio.m4a" };
}

async function readTranscriptionResponse(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const body = await response.text();
    try {
      const result = JSON.parse(body) as { text?: string };
      return result.text?.trim() ?? "";
    } catch {
      return "";
    }
  }

  const body = await response.text();
  let finalText = "";
  let streamedText = "";
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const event = JSON.parse(payload) as { type?: string; delta?: string; text?: string };
      if (event.type === "transcript.text.delta" && event.delta) streamedText += event.delta;
      if (event.type === "transcript.text.done" && event.text) finalText = event.text;
    } catch {
      // Ignore keep-alive or provider-specific SSE lines.
    }
  }
  return (finalText || streamedText).trim();
}

/**
 * Caption-free fallback: download the video's audio track directly from
 * YouTube's streaming data and transcribe it (Lovable AI first, then Google
 * Gemini). Pure fetch, so it runs in the edge runtime (no yt-dlp).
 */
export async function transcribeYoutubeAudio(videoId: string, apiKey?: string): Promise<string> {
  const { getRuntimeSecret } = await import("./runtime-env.server");
  const lovableKey = getRuntimeSecret("LOVABLE_API_KEY");
  const geminiKey = apiKey ?? getRuntimeSecret("GEMINI_API_KEY");
  // Prefer Lovable AI (no extra key / quota needed); fall back to Gemini directly.
  const providers: { url: string; key: string; model: string; gemini: boolean }[] = [];
  if (lovableKey)
    providers.push({
      url: "https://ai.gateway.lovable.dev/v1/audio/transcriptions",
      key: lovableKey,
      model: "openai/gpt-4o-transcribe",
      gemini: false,
    });
  if (geminiKey) {
    const { DEFAULT_GEMINI_MODEL, geminiGenerateUrl } = await import("./ai-models");
    const model = getRuntimeSecret("GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL;
    providers.push({
      url: geminiGenerateUrl(model),
      key: geminiKey,
      model,
      gemini: true,
    });
  }
  if (providers.length === 0) throw new Error("youtube_transcription_unavailable");


  // Collect audio streams from every innertube client. Mobile clients (ANDROID
  // / IOS) return URLs that download without a PoToken, but only when the
  // request repeats that client's own User-Agent — otherwise googlevideo 403s.
  const formats: (AudioFormat & { ua: string })[] = [];
  let playability: { status?: string; reason?: string } | undefined;
  for (const c of INNERTUBE_CLIENTS) {
    try {
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${c.key}&prettyPrint=false`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": c.ua },
          body: JSON.stringify({ videoId, context: c.context }),
        },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as InnertubePlayer;
      playability ??= json.playabilityStatus;
      for (const f of json.streamingData?.adaptiveFormats ?? []) {
        if (f.mimeType?.startsWith("audio/") && f.url) formats.push({ ...f, ua: c.ua });
      }
    } catch {
      /* try next client */
    }
  }
  if (formats.length === 0) {
    console.error("[youtube] no direct audio stream", {
      videoId,
      status: playability?.status,
      reason: playability?.reason,
    });
    throw new Error("youtube_audio_unavailable");
  }

  // No pre-filtering: every audio stream YouTube hands us is a candidate.
  // Ranking only decides the *order* we try them in, never excludes any.
  const rank = (format: AudioFormat & { ua: string }) => {
    const mime = format.mimeType?.toLowerCase() ?? "";
    const bitrate = format.bitrate ?? 0;
    let score = 0;
    if (mime.includes("mp4a")) score -= 40; // itag 140 & friends: most reliable
    if (mime.includes("opus")) score -= 20;
    // Mobile-app clients serve URLs that work without a PoToken.
    if (!format.ua.startsWith("Mozilla")) score -= 200;
    if (mime.includes("drc")) score += 100; // DRC variants 403 more often
    // Prefer a mid bitrate: closest to 128 kbps.
    score += Math.abs(bitrate - 128_000) / 100_000;
    return score;
  };

  // Deduplicate identical URLs, then try them all — smallest-first ordering is
  // handled by rank(). Oversized files are still usable: we range-request the
  // first chunk instead of skipping the stream.
  const seen = new Set<string>();
  const candidates = formats
    .filter((f) => {
      const url = f.url ?? "";
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .sort((a, b) => rank(a) - rank(b));

  let lastError: Error | null = null;
  let downloadedAny = false;

  /** Downloads one audio file, trying every request style YouTube accepts. */
  const downloadAudio = async (format: AudioFormat & { ua: string }): Promise<Uint8Array | null> => {
    const size = Number(format.contentLength ?? 0);
    const baseUrl = format.url ?? "";
    if (!baseUrl) return null;

    // googlevideo rejects large single range requests (usually with 403), even
    // when the exact same signed URL accepts smaller ranges. Download in 1 MiB
    // pieces and join them so the transcription provider receives a complete,
    // valid audio container instead of one oversized rejected request.
    const targetSize = size > 0 ? Math.min(size, WHISPER_MAX_BYTES) : WHISPER_MAX_BYTES;
    const chunkSize = 1024 * 1024;
    const chunks: Uint8Array[] = [];
    let downloaded = 0;
    while (downloaded < targetSize) {
      const end = Math.min(downloaded + chunkSize, targetSize) - 1;
      try {
        const res = await fetch(baseUrl, {
          headers: {
            "User-Agent": format.ua,
            Range: `bytes=${downloaded}-${end}`,
          },
        });
        if (!res.ok) {
          console.error("[youtube] audio download rejected", {
            videoId,
            status: res.status,
            mimeType: format.mimeType,
            bitrate: format.bitrate,
            range: `${downloaded}-${end}`,
          });
          // Some signed URLs allow only the initial range. A prefix still
          // contains enough speech for lesson generation and is preferable to
          // failing the entire request with youtube_audio_unavailable.
          if (downloaded >= chunkSize) break;
          return null;
        }
        const chunk = new Uint8Array(await res.arrayBuffer());
        if (chunk.length === 0) return null;
        chunks.push(chunk);
        downloaded += chunk.length;
        if (chunk.length < end - downloaded + chunk.length + 1) break;
      } catch (error) {
        console.error("[youtube] audio download failed", error);
        return null;
      }
    }

    if (downloaded < 1024) return null;
    const audio = new Uint8Array(downloaded);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }
    return audio;
  };

  for (const format of candidates) {

    const audio = await downloadAudio(format);
    if (!audio) {
      lastError ??= new Error("youtube_audio_unavailable");
      continue;
    }
    downloadedAny = true;




    for (const p of providers) {
      try {
        const file = audioFileDetails(format.mimeType);
        let response: Response;

        if (p.gemini) {
          let binary = "";
          for (let i = 0; i < audio.length; i += 0x8000) {
            binary += String.fromCharCode(...audio.subarray(i, i + 0x8000));
          }
          response = await fetch(p.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": p.key },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: "Transcribe this audio verbatim. Return only the transcript text." },
                    { inline_data: { mime_type: file.mime, data: btoa(binary) } },
                  ],
                },
              ],
            }),
          });
        } else {
          const form = new FormData();
          form.append(
            "file",
            new Blob([audio.slice().buffer as ArrayBuffer], { type: file.mime }),
            file.name,
          );
          form.append("model", p.model);
          form.append("response_format", "json");
          response = await fetch(p.url, {
            method: "POST",
            headers: { "Lovable-API-Key": p.key, "X-Lovable-AIG-SDK": "direct-fetch" },
            body: form,
          });
        }

        if (!response.ok) {
          const providerError = (await response.text()).slice(0, 500);
          console.error("[youtube] transcription provider rejected audio", {
            provider: p.gemini ? "gemini" : "lovable",
            status: response.status,
            error: providerError,
          });
          if (p.gemini && (response.status === 401 || response.status === 403))
            lastError = new Error("gemini_invalid_key");
          else if (p.gemini && (response.status === 429 || response.status === 402))
            lastError = new Error("gemini_quota");
          else lastError = new Error("youtube_transcription_failed");
          continue;
        }

        let text: string;
        if (p.gemini) {
          const json = (await response.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          text = (json.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? "").join("");
        } else {
          text = await readTranscriptionResponse(response);
        }
        text = text.replace(/\s{2,}/g, " ").trim();
        if (text) return text;

      } catch (error) {
        console.error("[youtube] transcription request failed", error);
        lastError = error instanceof Error ? error : new Error("youtube_transcription_failed");
      }
    }
  }
  if (!downloadedAny) throw new Error("youtube_audio_unavailable");
  if (lastError) throw lastError;
  throw new Error("youtube_transcription_failed");
}


export type YoutubeTranscript = { videoId: string; title: string; text: string };

/** Throws `youtube_invalid_url` or `youtube_no_captions` on failure. */
export async function fetchYoutubeTranscript(
  input: string,
  apiKey?: string,
): Promise<YoutubeTranscript> {
  const videoId = parseYoutubeId(input);
  if (!videoId) throw new Error("youtube_invalid_url");

  let title = "";
  let tracks: CaptionTrack[] = [];

  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      },
    });
    if (res.ok) {
      const html = await res.text();
      const titleMatch =
        html.match(/<meta\s+name="title"\s+content="([^"]*)"/) ??
        html.match(/<title>([^<]*)<\/title>/);
      title = decodeEntities(titleMatch?.[1] ?? "").replace(/\s*-\s*YouTube$/, "").trim();
      tracks = extractJson<CaptionTrack[]>(html, '"captionTracks"') ?? [];
    }
  } catch {
    /* fall back to innertube */
  }

  if (tracks.length === 0) {
    const alt = await fetchInnertube(videoId);
    if (alt) {
      tracks = alt.tracks;
      title = title || alt.title;
    }
  }

  // Prefer Arabic, then English, then manual, then anything.
  const ordered = [
    tracks.find((tr) => tr.languageCode === "ar" && tr.kind !== "asr"),
    tracks.find((tr) => tr.languageCode === "ar"),
    tracks.find((tr) => tr.languageCode?.startsWith("en") && tr.kind !== "asr"),
    tracks.find((tr) => tr.languageCode?.startsWith("en")),
    tracks.find((tr) => tr.kind !== "asr"),
    ...tracks,
  ].filter((t): t is CaptionTrack => Boolean(t?.baseUrl));

  let text = "";
  const seen = new Set<string>();
  for (const track of ordered) {
    if (seen.has(track.baseUrl)) continue;
    seen.add(track.baseUrl);
    text = await fetchTrackText(track.baseUrl);
    if (text.length >= 40) break;
  }

  // Last-resort captions: YouTube's public timedtext endpoint (works for some
  // videos whose caption tracks are missing from the player response).
  if (text.length < 40) {
    for (const lang of ["ar", "en"]) {
      for (const extra of ["", "&kind=asr"]) {
        text = await fetchTrackText(
          `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}${extra}`,
        );
        if (text.length >= 40) break;
      }
      if (text.length >= 40) break;
    }
  }

  // No captions at all → transcribe the audio itself. Lovable AI is the
  // primary provider, so this must run even when no direct OpenAI key exists.
  if (text.length < 40) {
    text = await transcribeYoutubeAudio(videoId, apiKey);
  }

  if (text.length < 40) throw new Error("youtube_no_captions");

  return { videoId, title: title || "YouTube", text: text.slice(0, 40000) };
}
