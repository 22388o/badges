import { useEffect, useState } from "react";
import { atom, useAtom } from "jotai";

import { useNostrEvents } from "./core";
import { uniqValues } from "./utils";
import useCached from "../lib/useCached";
import { setKey } from "../storage";

export interface Metadata {
  name?: string;
  username?: string;
  display_name?: string;
  picture?: string;
  banner?: string;
  about?: string;
  website?: string;
  lud06?: string;
  lud16?: string;
  nip05?: string;
}

const QUEUE_DEBOUNCE_DURATION = 100;

let timer: NodeJS.Timeout | undefined = undefined;

const queuedPubkeysAtom = atom<string[]>([]);
const requestedPubkeysAtom = atom<string[]>([]);
const fetchedProfilesAtom = atom<Record<string, Metadata>>({});

function useProfileQueue({ pubkey }: { pubkey: string }) {
  const [isReadyToFetch, setIsReadyToFetch] = useState(false);

  const [queuedPubkeys, setQueuedPubkeys] = useAtom(queuedPubkeysAtom);

  const [requestedPubkeys] = useAtom(requestedPubkeysAtom);
  const alreadyRequested = !!requestedPubkeys.includes(pubkey);

  useEffect(() => {
    if (alreadyRequested) {
      return;
    }

    clearTimeout(timer);

    timer = setTimeout(() => {
      setIsReadyToFetch(true);
    }, QUEUE_DEBOUNCE_DURATION);

    setQueuedPubkeys((_pubkeys: string[]) => {
      // Unique values only:
      const arr = [..._pubkeys, pubkey].filter(uniqValues).filter((_pubkey) => {
        return !requestedPubkeys.includes(_pubkey);
      });

      return arr;
    });
  }, [pubkey, setQueuedPubkeys, alreadyRequested, requestedPubkeys]);

  return {
    pubkeysToFetch: isReadyToFetch ? queuedPubkeys : [],
  };
}

export function useProfile({
  pubkey,
  relays,
  enabled: _enabled = true,
}: {
  pubkey: string;
  relays?: string[];
  enabled?: boolean;
}) {
  const [, setRequestedPubkeys] = useAtom(requestedPubkeysAtom);
  const { pubkeysToFetch } = useProfileQueue({ pubkey });
  const enabled = _enabled && !!pubkeysToFetch.length;

  const [fetchedProfiles, setFetchedProfiles] = useAtom(fetchedProfilesAtom);
  const data = fetchedProfiles[pubkey];
  const profile = useCached(`metadata:${pubkey}`, data);

  const { onEvent, onSubscribe, isLoading, onDone } = useNostrEvents({
    filter: {
      kinds: [0],
      authors: pubkeysToFetch,
    },
    relays,
    enabled,
  });

  onSubscribe(() => {
    // Reset list
    // (We've already opened a subscription to these pubkeys now)
    setRequestedPubkeys((_pubkeys) => {
      return [..._pubkeys, ...pubkeysToFetch].filter(uniqValues);
    });
  });

  onEvent((rawMetadata) => {
    try {
      const metadata: Metadata = JSON.parse(rawMetadata.content);
      const metaPubkey = rawMetadata.pubkey;

      if (metadata) {
        setKey(`metadata:${metaPubkey}`, rawMetadata.content);
        setFetchedProfiles((_profiles: Record<string, Metadata>) => {
          return {
            ..._profiles,
            [metaPubkey]: metadata,
          };
        });
      }
    } catch (err) {
      console.error(err, rawMetadata);
    }
  });

  return {
    isLoading,
    onDone,
    data: profile,
  };
}
