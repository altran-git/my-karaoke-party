import { useState } from "react";
import { api } from "~/trpc/react";
import { Plus, Search, Check, Loader2, Frown, Sparkles } from "lucide-react";
import { PreviewPlayer } from "./preview-player";
import { removeBracketedContent } from "~/utils/string";
import { decode } from "html-entities";
import { Input } from "./ui/ui/input";
import { Button } from "./ui/ui/button";
import { Skeleton } from "./ui/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "./ui/ui/alert";
import { PoweredByYouTube } from "./powered-by-youtube";
import { SuggestionList, useSongSuggestions } from "./song-suggestions";

type Props = {
  onVideoAdded: (videoId: string, title: string, coverUrl: string) => void;
  /** Songs already added, shown with a check instead of a + button. */
  playlist: { id: string; title?: string; playedAt?: Date | string | null }[];
  /** Show the Suggest button (songs from the saved playlists). */
  showSuggest?: boolean;
};

export function SongSearch({
  onVideoAdded,
  playlist,
  showSuggest = true,
}: Props) {
  const [videoInputValue, setVideoInputValue] = useState("");
  const [canFetch, setCanFetch] = useState(false);

  // Suggest shows songs from the saved playlists where the search results
  // go; searching swaps them back for the results. Every press of Suggest
  // deals a new mix of songs.
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionMix, setSuggestionMix] = useState(0);
  // Suggested songs added from this list stay in it, with a check.
  const [addedSuggestions, setAddedSuggestions] = useState<string[]>([]);

  const suggestions = useSongSuggestions(playlist, {
    enabled: showSuggestions,
    count: 25,
    keepIds: addedSuggestions,
    shuffle: suggestionMix,
  });

  const { data, isError, refetch, isLoading, isFetched } =
    api.youtube.search.useQuery(
      {
        keyword: `${videoInputValue} karaoke`,
      },
      { refetchOnWindowFocus: false, enabled: false, retry: false },
    );

  // const [canPlayVideos, setCanPlayVideos] = useState<string[]>([]);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setShowSuggestions(false);
        await refetch();
        setCanFetch(false);
      }}
    >
      <div className="flex w-full items-center space-x-2">
        <Input
          type="text"
          name="video-url"
          placeholder="Enter artist and/or song name..."
          className="w-full"
          value={videoInputValue}
          onChange={(e) => {
            setVideoInputValue(e.target.value);
            setCanFetch(e.target.value.length >= 3);
          }}
          required
          minLength={3}
          autoComplete="off"
        />
        <Button type="submit" disabled={isLoading || !canFetch}>
          {isLoading ? (
            <Loader2 className="mx-1 h-6 w-6 animate-spin" />
          ) : (
            <Search className="mx-1 h-6 w-6" />
          )}
        </Button>
        {showSuggest && (
          <Button
            type="button"
            variant={showSuggestions ? "default" : "secondary"}
            title="Suggest songs from the saved playlists (press again for different ones)"
            onClick={() => {
              setAddedSuggestions([]);
              setSuggestionMix((mix) => mix + 1);
              setShowSuggestions(true);
            }}
          >
            <Sparkles className="mr-1.5 h-5 w-5" />
            Suggest
          </Button>
        )}
      </div>

      {showSuggestions && (
        <div className="mb-10 mt-5">
          {suggestions.isLoading ? (
            <div className="flex flex-col space-y-2">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          ) : suggestions.songs.length > 0 ? (
            <SuggestionList
              songs={suggestions.songs}
              isAdded={(id) =>
                !!playlist.find((v) => v.id === id && !v.playedAt)
              }
              onAdd={(id, title, coverUrl) => {
                setAddedSuggestions((ids) => [...ids, id]);
                onVideoAdded(id, title, coverUrl);
              }}
            />
          ) : (
            <Alert>
              <Frown className="h-4 w-4" />
              <AlertTitle>No suggestions yet</AlertTitle>
              <AlertDescription>
                {suggestions.isError
                  ? "Couldn't load suggestions. Try again later."
                  : "Suggestions come from saved playlists. Save a playlist, or search for a song above."}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {!showSuggestions && isError && (
        <Alert variant={"destructive"} className="mt-4 bg-red-500 text-white">
          <Frown className="h-4 w-4" color="white" />
          <AlertTitle>Error!</AlertTitle>
          <AlertDescription>
            There was an unexpected error while searching for karaoke videos.
            Try again later.
          </AlertDescription>
        </Alert>
      )}

      {!showSuggestions && isFetched && !isError && !data?.length && (
        <Alert className="mt-4">
          <Frown className="h-4 w-4" />
          <AlertTitle>Nothing found!</AlertTitle>
          <AlertDescription>
            No karaoke videos found for {videoInputValue}
          </AlertDescription>
        </Alert>
      )}

      {!showSuggestions && isLoading && (
        <div className="my-5 flex flex-col space-y-5 overflow-hidden">
          <Skeleton className="h-48 w-full rounded-xl" />

          <Skeleton className="h-48 w-full rounded-xl" />

          <Skeleton className="h-48 w-full rounded-xl" />

          <Skeleton className="h-48 w-full rounded-xl" />

          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      )}

      {!showSuggestions && data && (
        <div className="my-5 flex flex-col space-y-5 overflow-hidden">
          {data.map((video) => {
            const alreadyAdded = !!playlist.find(
              (v) => v.id === video.id.videoId && !v.playedAt,
            );

            const title = decode(removeBracketedContent(video.snippet.title));

            return (
              <div
                key={video.id.videoId}
                className={
                  "relative h-48 overflow-hidden rounded-lg animate-in fade-in"
                }
              >
                <PreviewPlayer
                  key={video.id.videoId}
                  videoId={video.id.videoId}
                  title={title}
                  thumbnail={video.snippet.thumbnails.high.url}
                />
                <div className="absolute inset-0 z-10 rounded-lg bg-black opacity-50" />

                <div className="absolute top-0 z-30 w-full rounded-lg opacity-100">
                  <p className="bg-black bg-opacity-70 p-3 text-xl font-bold text-white">
                    {title}
                  </p>
                </div>

                <div className="absolute bottom-3 right-3 z-30 flex w-full justify-between opacity-100">
                  <div>
                    <p className="bg-black bg-opacity-70 p-2 pl-5 text-sm text-white">
                      {video.snippet.channelTitle}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={"default"}
                    size="icon"
                    className="shadow-xl animate-in spin-in"
                    disabled={alreadyAdded}
                    onClick={() =>
                      onVideoAdded(
                        video.id.videoId,
                        removeBracketedContent(video.snippet.title),
                        video.snippet.thumbnails.high.url,
                      )
                    }
                  >
                    {alreadyAdded ? <Check stroke="pink" /> : <Plus />}
                  </Button>
                </div>
              </div>
            );
          })}

          <PoweredByYouTube className="text-center opacity-80" />
        </div>
      )}
    </form>
  );
}
