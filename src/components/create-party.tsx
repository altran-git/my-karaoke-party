"use client";

import { useRouter } from "next/navigation";
import { type CSSProperties, useCallback, useRef, useState } from "react";
import ReactCanvasConfetti from "react-canvas-confetti";
import { api } from "~/trpc/react";
import { rememberParty } from "~/utils/recent-parties";
import { Input } from "./ui/ui/input";
import { ButtonHoverGradient } from "./ui/ui/button-hover-gradient";

const canvasStyles = {
  position: "absolute",
  pointerEvents: "none",
  width: "100%",
  height: "100%",
  zIndex: 1,
  overflow: "hidden",
  top: 0,
  left: 0,
} satisfies CSSProperties;

// Animation variants for the container
// const containerVariants = {
//   hidden: { opacity: 0, y: 50 },
//   visible: { opacity: 1, y: 0 },
// };

export function CreateParty() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const createParty = api.party.create.useMutation({
    onSuccess: (party) => {
      if (party.hash) {
        rememberParty({
          hash: party.hash,
          name: party.name,
          hostKey: party.hostKey,
        });
      }

      fire(); // Trigger the confetti animation

      // Redirect to the party page
      setTimeout(() => {
        // "created" makes the player screen show the host code once.
        router.push(`/player/${party.hash}?created=1`);
      }, 1000);
    },
  });

  // Reference to hold the confetti animation instance
  const refAnimationInstance = useRef(null);

  // Callback to get the instance of the confetti animation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getInstance = useCallback((instance: any) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    refAnimationInstance.current = instance;
  }, []);

  // Function to create a confetti shot with specified options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeShot = useCallback((opts: any, originX: number, angle: number) => {
    if (refAnimationInstance.current) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
      (refAnimationInstance.current as any)({
        ...opts,
        origin: { x: originX, y: 0.5 },
        angle: angle,
        particleCount: 500,
      });
    }
  }, []);

  // Function to trigger confetti shots from different positions
  const fire = useCallback(() => {
    // Left side shot
    makeShot({ spread: 100, startVelocity: 40 }, -0.2, 20);

    // Right side shot
    makeShot({ spread: 100, startVelocity: 40 }, 1.2, 160);

    // More shots can be added here if desired
  }, [makeShot]);

  return (
    <>
      <ReactCanvasConfetti refConfetti={getInstance} style={canvasStyles} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createParty.mutate({ name, code: code.trim() || undefined });
        }}
        className="flex w-full max-w-xs flex-col gap-2"
      >
        <Input
          name="name"
          type="text"
          placeholder="Party Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={3}
          required
          autoComplete="off"
          className="text-lg"
          autoFocus
        />

        <Input
          name="code"
          type="text"
          placeholder="Custom code (optional)"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (createParty.isError) createParty.reset();
          }}
          maxLength={30}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono placeholder:font-sans"
        />

        {createParty.error && (
          <p role="alert" className="text-sm font-medium text-red-200">
            {createParty.error.message}
          </p>
        )}

        {/* <AnimatedGradientText>
          🎉 <hr className="mx-2 h-4 w-[1px] shrink-0 bg-gray-300" />{" "}
          <span
            className={cn(
              `animate-gradient inline bg-gradient-to-r from-[#ffaa40] via-[#9c40ff] to-[#ffaa40] bg-[length:var(--bg-size)_100%] bg-clip-text text-transparent`,
            )}
          >
            Start Party!
          </span>
          <ChevronRight className="ml-1 size-3 transition-transform duration-300 ease-in-out group-hover:translate-x-0.5" />
        </AnimatedGradientText> */}

        <ButtonHoverGradient type="submit" disabled={createParty.isPending}>
          {createParty.isPending ? "Creating..." : "Start Party 🎉"}
        </ButtonHoverGradient>

        {/* <ShimmerButton className="shadow-2xl">
          <span className="whitespace-pre-wrap text-center text-sm font-medium leading-none tracking-tight text-white lg:text-lg dark:from-white dark:to-slate-900/10">
            Start Party
          </span>
        </ShimmerButton> */}
      </form>
    </>
  );
}
