import { cn } from "~/lib/utils";

/**
 * Attribution required by the YouTube API Services branding guidelines:
 * shown wherever the app uses YouTube search results or playback.
 * Text only, so the official YouTube logo is never altered or imitated.
 */
export function PoweredByYouTube({ className }: { className?: string }) {
  return (
    <p className={cn("text-sm", className)}>
      Song search and playback powered by{" "}
      <a
        href="https://www.youtube.com"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold underline underline-offset-2"
      >
        YouTube
      </a>
    </p>
  );
}
