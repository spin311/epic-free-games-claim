import {useCallback, useEffect, useState} from "react";
import {browser} from '#imports';
import {getStorageItems} from "@/entrypoints/hooks/useStorage.ts";
import {REVIEW_PROMPT_ANSWERED_AT_KEY, REVIEW_PROMPT_KEY} from "@/entrypoints/utils/reviewPrompt.ts";
import {choosePrompt, SPONSOR_PROMPT_KEY, type PromptChoice} from "@/entrypoints/utils/sponsorPrompt.ts";

export interface PromptChoiceState {
    // undefined until storage has been read, so no card flashes in and out.
    choice: PromptChoice | undefined;
    claimedCount: number;
    // Hides the card after an answer without re-deciding.
    answered: () => void;
}

/** Decides once at popup load which card to show (storage read before render). */
export function usePromptChoice(): PromptChoiceState {
    const [choice, setChoice] = useState<PromptChoice | undefined>(undefined);
    const [claimedCount, setClaimedCount] = useState(0);

    useEffect(() => {
        void getStorageItems(["counter", REVIEW_PROMPT_KEY, REVIEW_PROMPT_ANSWERED_AT_KEY, SPONSOR_PROMPT_KEY])
            .then((stored) => {
                const count = typeof stored.counter === "number" ? stored.counter : 0;
                setClaimedCount(count);
                setChoice(choosePrompt({
                    claimedCount: count,
                    reviewAnswer: stored[REVIEW_PROMPT_KEY],
                    reviewAnsweredAt: stored[REVIEW_PROMPT_ANSWERED_AT_KEY],
                    sponsorAnswer: stored[SPONSOR_PROMPT_KEY],
                    now: Date.now(),
                    env: {isFirefox: import.meta.env.FIREFOX === true, extensionId: browser.runtime.id},
                }));
            })
            .catch(() => setChoice(null));
    }, []);

    const answered = useCallback(() => setChoice(null), []);
    return {choice, claimedCount, answered};
}
