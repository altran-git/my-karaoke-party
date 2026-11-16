/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { useCallback, useEffect, useRef, useState } from "react";
import YouTube, { type YouTubeProps, type YouTubePlayer } from "react-youtube";
import { QrCode } from "./qr-code";
import { type VideoInPlaylist } from "party/types";
import { decode } from "html-entities";
import { cn } from "~/lib/utils";
import { Button } from "./ui/ui/button";
import { MicVocal, SkipForward, Youtube } from "lucide-react";
import { Spinner } from "./ui/ui/spinner";

type Props = {
  joinPartyUrl: string;
  video: VideoInPlaylist;
  /** The song queued after this one, shown in a small "Up next" line. */
  nextVideo?: VideoInPlaylist;
  isFullscreen: boolean;
  onPlayerEnd: () => void;
  onTogglePlayPauseRef?: React.MutableRefObject<(() => void) | null>;
  /** Filled in with a function that plays (true) or pauses (false) the video. */
  onSetPlayingRef?: React.MutableRefObject<
    ((playing?: boolean) => void) | null
  >;
  /** Called whenever the video starts or stops playing. */
  onPlayingChange?: (playing: boolean) => void;
};

export function Player({
  joinPartyUrl,
  video,
  nextVideo,
  isFullscreen = false,
  onPlayerEnd,
  onTogglePlayPauseRef,
  onSetPlayingRef,
  onPlayingChange,
}: Props) {
  const playerRef = useRef<YouTubePlayer>(null);

  const [isReady, setIsReady] = useState(false);
  const [showOpenInYouTubeButton, setShowOpenInYouTubeButton] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  // The song title and singer stay on screen for this long after the song
  // starts, then hide while it plays. They show again whenever it's paused.
  const SONG_INFO_DURATION_MS = 10_000;
  const [songInfoTimeUp, setSongInfoTimeUp] = useState(false);
  const songInfoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (songInfoTimerRef.current) clearTimeout(songInfoTimerRef.current);
    };
  }, []);

  const togglePlayPause = useCallback(() => {
    if (playerRef.current && isReady) {
      const playerState = playerRef.current.getPlayerState();
      // YouTube player states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
      if (playerState === 1) {
        // Playing - pause it
        playerRef.current.pauseVideo();
      } else if (playerState === 2 || playerState === 5 || playerState === -1) {
        // Paused, cued, or unstarted - play it
        playerRef.current.playVideo();
      }
    }
  }, [isReady]);

  // Set ref for global play/pause
  useEffect(() => {
    if (onTogglePlayPauseRef && isReady) {
      onTogglePlayPauseRef.current = togglePlayPause;
    }
  }, [onTogglePlayPauseRef, togglePlayPause, isReady]);

  /** Plays (true) or pauses (false) the video; toggles when `playing` is omitted. */
  const setPlaying = useCallback(
    (playing?: boolean) => {
      if (!playerRef.current || !isReady) return;

      // YouTube player states: 1 playing, 3 buffering (about to play)
      const state = playerRef.current.getPlayerState();
      const isNowPlaying = state === 1 || state === 3;
      const target = playing ?? !isNowPlaying;

      if (target === isNowPlaying) {
        // Nothing to change, so no play/pause event will fire: report the
        // state anyway so the phone that asked shows the right button.
        onPlayingChange?.(isNowPlaying);
      } else if (target) {
        playerRef.current.playVideo();
      } else {
        playerRef.current.pauseVideo();
      }
    },
    [isReady, onPlayingChange],
  );

  // Set ref for remote play/pause (from guests' phones)
  useEffect(() => {
    if (!onSetPlayingRef) return;

    onSetPlayingRef.current = isReady ? setPlaying : null;

    return () => {
      onSetPlayingRef.current = null;
    };
  }, [onSetPlayingRef, setPlaying, isReady]);

  const opts: YouTubeProps["opts"] = {
    playerVars: {
      // https://developers.google.com/youtube/player_parameters
      start: 0,
      // Start each song as soon as it loads, so the queue plays on after a
      // song ends or is skipped. Browsers may still block this until someone
      // has clicked on the page.
      autoplay: 1,
      rel: 0,
      controls: 1,
      // Hide YouTube's fullscreen button: it fullscreens only the video and
      // drops our overlay (QR code, Skip). Use the app's fullscreen instead.
      fs: 0,
    },
  };

  const onPlayerReady: YouTubeProps["onReady"] = (event) => {
    console.log("Player ready", { event });
    // access to player in all event handlers via event.target
    playerRef.current = event.target;

    setIsReady(true);
  };

  const onPlayerPlay: YouTubeProps["onPlay"] = (_event) => {
    console.log("handlePlay");
    setIsPlaying(true);
    onPlayingChange?.(true);

    if (!songInfoTimerRef.current) {
      songInfoTimerRef.current = setTimeout(
        () => setSongInfoTimeUp(true),
        SONG_INFO_DURATION_MS,
      );
    }
  };

  const onPlayerPause: YouTubeProps["onPause"] = (_event) => {
    console.log("handlePause");
    setIsPlaying(false);
    onPlayingChange?.(false);
  };

  const onPlayerError: YouTubeProps["onError"] = (_event) => {
    setShowOpenInYouTubeButton(true);
  };

  const openYouTubeTab = () => {
    window.open(
      `https://www.youtube.com/watch?v=${video.id}#mykaraokeparty`,
      "_blank",
      "fullscreen=yes"
    );

    if (onPlayerEnd) {
      onPlayerEnd();
    }
  };

  if (showOpenInYouTubeButton) {
    return (
      <div
        className={cn(
          "mx-auto flex h-full w-full flex-col items-center justify-between space-y-6 p-4 pb-1 text-center",
          isFullscreen && "bg-gradient"
        )}
      >
        <div>
          <h1 className="text-outline scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
            {decode(video.title)}
          </h1>
          <h2 className="text-outline scroll-m-20 text-3xl font-bold tracking-tight lg:text-4xl">
            <MicVocal className="mr-2 inline text-primary" size={32} />
            {video.singerName}
            <MicVocal
              className="ml-2 inline scale-x-[-1] transform text-primary"
              size={32}
            />
          </h2>
        </div>

        <div>
          <h3 className="mb-2 scroll-m-20 text-2xl font-semibold tracking-tight animate-in fade-in zoom-in">
            This video cannot be embedded. Click the button to open a new tab in
            YouTube.
          </h3>
          <Button
            type="button"
            className="w-fit self-center animate-in fade-in zoom-in"
            onClick={() => openYouTubeTab()}
          >
            Play in YouTube
            <Youtube className="ml-2" />
          </Button>
          <div className="mt-2">
            <Button
              className="animate-in fade-in zoom-in"
              variant={"secondary"}
              type="button"
              onClick={() => {
                onPlayerEnd();
              }}
            >
              <SkipForward className="mr-2 h-5 w-5" />
              Skip
            </Button>
          </div>
        </div>

        <div className="relative flex w-full basis-1/4 items-end text-center">
          <QrCode url={joinPartyUrl} />
          <a
            href={joinPartyUrl}
            target="_blank"
            className="font-mono text-xl text-white pl-4"
          >
            {joinPartyUrl.split("//")[1]}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-0 h-full">
      <YouTube
        key={video.id}
        loading="eager"
        // className={`h-full w-full`}
        className={`h-full w-full animate-in fade-in ${
          isReady ? "visible" : "invisible"
        }`}
        iframeClassName="w-full h-full"
        // iframeClassName="p2 fixed bottom-0 right-0 h-auto min-h-full w-auto min-w-full"
        videoId={video.id}
        opts={opts}
        onPlay={onPlayerPlay}
        onReady={onPlayerReady}
        onPause={onPlayerPause}
        onError={onPlayerError}
        onEnd={() => {
          onPlayerEnd();
        }}
      />
      <div
        className={cn(
          "absolute top-0 w-full text-center animate-in fade-in zoom-in",
          isPlaying && songInfoTimeUp ? "hidden" : "block"
        )}
      >
        <div
          className={`flex w-full flex-col items-center justify-center bg-black p-4 ${
            isReady ? "bg-opacity-80" : "bg-opacity-0"
          }`}
        >
          <h1 className="text-outline scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
            {decode(video.title)}
          </h1>
          <h2 className="text-outline scroll-m-20 text-3xl font-bold tracking-tight lg:text-4xl">
            <MicVocal className="mr-2 inline text-primary" size={32} />
            {video.singerName}
            <MicVocal
              className="ml-2 inline scale-x-[-1] transform text-primary"
              size={32}
            />
          </h2>
        </div>

        {!isReady && (
          <div>
            <Spinner size={"large"} />
          </div>
        )}
      </div>

      {/* Sits in the middle of YouTube's control bar, below the seek bar.
          Clicks pass through, so the controls under it still work. */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 max-w-[60%] -translate-x-1/2 truncate rounded-full text-outline bg-black/[0.01] px-4 py-1 text-center text-sm text-white lg:text-base">
        {/* Only the text is faded, so the background stays as set above. */}
        <span className="opacity-60">
          {nextVideo ? (
            <>
              <span className="font-semibold uppercase tracking-wide text-primary">
                Up next:
              </span>{" "}
              {decode(nextVideo.title)}
              <span className="text-slate-300"> · requested by </span>
              <span className="font-semibold">{nextVideo.singerName}</span>
            </>
          ) : (
            <span className="text-slate-300">No songs in queue</span>
          )}
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-32 left-0 z-10 flex w-full flex-row justify-between px-4">
        {/* ml-12 keeps the QR code clear of the edge on TVs that crop the
            picture (overscan), so it can still be scanned. size is smaller
            than the 128px default so it covers less of the lyrics. */}
        <QrCode
          url={joinPartyUrl}
          size={100}
          className="pointer-events-auto ml-12"
        />

        <div
          className={`pointer-events-auto self-end p-2 ${
            // Hide Skip while playing fullscreen, and always on the last song
            // in the queue (there's nothing to skip to).
            !nextVideo || (isPlaying && isFullscreen) ? "hidden" : "block"
          }`}
        >
          <Button
            // className="bg-yellow-300"
            variant={"secondary"}
            type="button"
            onClick={() => {
              onPlayerEnd();
            }}
          >
            <SkipForward className="mr-2 h-5 w-5" />
            Skip
          </Button>
          {/* <a
            href={joinPartyUrl}
            target="_blank"
            className="font-mono text-xl text-white"
          >
            {joinPartyUrl.split("//")[1]}
          </a> */}
        </div>
      </div>
    </div>
  );
}
