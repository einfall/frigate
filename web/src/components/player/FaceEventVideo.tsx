import { baseUrl } from "@/api/baseUrl";
import ActivityIndicator from "@/components/indicators/activity-indicator";
import { Button } from "@/components/ui/button";
import { useTimezone } from "@/hooks/use-date-utils";
import type { Event } from "@/types/event";
import type { FrigateConfig } from "@/types/frigateConfig";
import { REVIEW_PADDING } from "@/types/review";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuVideo } from "react-icons/lu";
import HlsVideoPlayer, { type HlsSource } from "./HlsVideoPlayer";

type FaceEventVideoProps = {
  config: FrigateConfig;
  event?: Event;
  timestamp?: number;
  loading: boolean;
};

type VideoStatus = "loading" | "ready" | "unavailable";

export default function FaceEventVideo({
  config,
  event,
  timestamp,
  loading,
}: FaceEventVideoProps) {
  const { t, i18n } = useTranslation("views/faceLibrary");
  const timezone = useTimezone(config);
  const [showVideo, setShowVideo] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ url?: string; status: VideoStatus }>({
    status: "loading",
  });
  const camera = event?.camera;
  const startTime = event?.start_time;
  const endTime = event?.end_time;

  const captureTime = useMemo(() => {
    if (startTime == undefined) return undefined;
    const time =
      timestamp != undefined && Number.isFinite(timestamp)
        ? timestamp
        : startTime;
    return Math.min(Math.max(time, startTime), endTime ?? time);
  }, [startTime, endTime, timestamp]);

  const source = useMemo<HlsSource | undefined>(() => {
    if (!camera || startTime == undefined || captureTime == undefined)
      return undefined;
    const start = Math.max(0, startTime - REVIEW_PADDING, captureTime - 5);
    const end = Math.min(
      (endTime ?? Date.now() / 1000) + REVIEW_PADDING,
      captureTime + 15,
    );
    if (end <= start) return undefined;
    return {
      playlist: `${baseUrl}vod/${encodeURIComponent(camera)}/start/${start}/end/${end}/index.m3u8`,
      startPosition: Math.max(0, captureTime - start - 2),
    };
  }, [camera, startTime, endTime, captureTime]);

  const captureDate = useMemo(
    () =>
      captureTime == undefined
        ? ""
        : new Intl.DateTimeFormat(i18n.resolvedLanguage, {
            dateStyle: "medium",
            timeStyle: "medium",
            timeZone: timezone,
          }).format(captureTime * 1000),
    [captureTime, i18n.resolvedLanguage, timezone],
  );

  useEffect(() => {
    if (!showVideo || !source) return;
    const controller = new AbortController();
    const checkRecording = async () => {
      try {
        const response = await fetch(source.playlist, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Recording unavailable");
        const playlist = await response.text();
        if (
          !playlist.trimStart().startsWith("#EXTM3U") ||
          !/#EXTINF:|#EXT-X-STREAM-INF:/.test(playlist)
        ) {
          throw new Error("Empty recording playlist");
        }
        if (!controller.signal.aborted)
          setResult({ url: source.playlist, status: "ready" });
      } catch {
        if (!controller.signal.aborted)
          setResult({ url: source.playlist, status: "unavailable" });
      }
    };
    void checkRecording();
    return () => controller.abort();
  }, [showVideo, source, attempt]);

  const onUnavailable = useCallback(() => {
    setResult({ url: source?.playlist, status: "unavailable" });
  }, [source?.playlist]);

  if (loading)
    return (
      <p role="status" className="px-2 text-sm text-secondary-foreground">
        {t("video.loadingEvent")}
      </p>
    );
  if (!event?.has_clip || !source)
    return (
      <p className="px-2 text-sm text-secondary-foreground">
        {t("video.unavailable")}
      </p>
    );
  const status = result.url === source.playlist ? result.status : "loading";

  return (
    <section className="mx-2 space-y-2" aria-label={t("video.label")}>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant={showVideo ? "select" : "default"}
          aria-expanded={showVideo}
          onClick={() => {
            setResult({ url: source.playlist, status: "loading" });
            setShowVideo(!showVideo);
          }}
        >
          <LuVideo className="mr-2 size-4" />
          {t(showVideo ? "video.hide" : "video.show")}
        </Button>
        <span className="text-sm text-secondary-foreground">
          {config.cameras[event.camera]?.friendly_name || event.camera} ·{" "}
          {captureDate}
        </span>
      </div>
      {showVideo && (
        <>
          <p className="text-xs text-secondary-foreground">
            {t("video.description")}
          </p>
          {status === "unavailable" ? (
            <div
              className="flex flex-wrap items-center gap-3 rounded-lg bg-background_alt p-4"
              role="status"
            >
              <span className="text-sm">{t("video.unavailable")}</span>
              <Button
                size="sm"
                onClick={() => {
                  setResult({ url: source.playlist, status: "loading" });
                  setAttempt((value) => value + 1);
                }}
              >
                {t("video.retry")}
              </Button>
            </div>
          ) : (
            <div className="relative h-[40dvh] max-h-96 w-full overflow-hidden rounded-lg bg-black [&_.react-transform-component]:!h-full">
              {status === "ready" ? (
                <FaceClipPlayer
                  key={source.playlist}
                  source={source}
                  onUnavailable={onUnavailable}
                />
              ) : (
                <LoadingVideo label={t("video.loading")} />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LoadingVideo({ label }: { label: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
      role="status"
      aria-label={label}
    >
      <ActivityIndicator />
    </div>
  );
}

function FaceClipPlayer({
  source,
  onUnavailable,
}: {
  source: HlsSource;
  onUnavailable: () => void;
}) {
  const { t } = useTranslation("views/faceLibrary");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const initialSeek = useRef(false);
  const stallTimeout = useRef<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (videoRef.current && videoRef.current.readyState < 2) onUnavailable();
    }, 15000);
    const video = videoRef.current;
    return () => {
      window.clearTimeout(timeout);
      window.clearTimeout(stallTimeout.current);
      // Native HLS also needs an explicit stop when its element is removed.
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [onUnavailable]);

  const onPlaybackError = useCallback(() => {
    const video = videoRef.current;
    // Buffering callbacks can arrive after playback has resumed or finished.
    if (
      !video ||
      video.paused ||
      video.ended ||
      video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA ||
      (Number.isFinite(video.duration) &&
        video.currentTime >= video.duration - 0.5)
    ) {
      return;
    }
    const stalledAt = video.currentTime;
    window.clearTimeout(stallTimeout.current);
    stallTimeout.current = window.setTimeout(() => {
      if (
        videoRef.current === video &&
        !video.paused &&
        !video.ended &&
        video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA &&
        Math.abs(video.currentTime - stalledAt) < 0.1
      ) {
        onUnavailable();
      }
    }, 10000);
  }, [onUnavailable]);

  return (
    <>
      {loading && <LoadingVideo label={t("video.loading")} />}
      <HlsVideoPlayer
        videoRef={videoRef}
        currentSource={source}
        hotKeys={false}
        visible
        frigateControls={false}
        fullscreen={false}
        supportsFullscreen={false}
        onError={onPlaybackError}
        onPlayerLoaded={() => {
          setLoading(false);
          if (!initialSeek.current && videoRef.current) {
            initialSeek.current = true;
            videoRef.current.currentTime = source.startPosition ?? 0;
          }
        }}
      />
    </>
  );
}
