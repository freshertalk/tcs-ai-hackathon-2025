// src/account/me.js
// What the collector knows about the signed-in person: their role, how long
// they have been a reader, what they have used. One shared copy, loaded when
// someone signs in and dropped when they sign out.
//
// "admin" here only decides which links are shown. Every admin action is
// checked again by the collector against the verified e-mail.

import { useCallback, useEffect, useState } from "react";
import { call } from "../api/collector";
import { currentUser, onSignIn, onSignOut, useAuth } from "../auth/google";

let me = null;
let status = "idle"; // idle | loading | ready | error
let failure = null;
let inflight = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function meSnapshot() {
  return me;
}

export function loadMe({ force = false } = {}) {
  if (!currentUser()) return Promise.resolve(null);
  if (!force && me) return Promise.resolve(me);
  if (inflight) return inflight;
  status = "loading";
  emit();
  inflight = call("me")
    .then((d) => {
      me = d;
      status = "ready";
      failure = null;
      return d;
    })
    .catch((e) => {
      status = "error";
      failure = e;
      return null;
    })
    .finally(() => {
      inflight = null;
      emit();
    });
  return inflight;
}

onSignIn(() => {
  me = null;
  status = "idle";
  loadMe({ force: true });
});

onSignOut(() => {
  me = null;
  status = "idle";
  failure = null;
  emit();
});

export function useMe() {
  const [, tick] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    const on = () => tick((n) => n + 1);
    listeners.add(on);
    return () => listeners.delete(on);
  }, []);

  useEffect(() => {
    if (user && !me && status === "idle") loadMe();
    // when the person arrives, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.email]);

  const reload = useCallback(() => loadMe({ force: true }), []);
  const known = user ? me : null;

  return {
    me: known,
    status: user ? status : "idle",
    error: failure,
    reload,
    // the collector's word once it has given it; until then the e-mail hint
    isAdmin: Boolean(user && (known ? known.role === "admin" : user.admin)),
    isOwner: Boolean(known && known.owner),
  };
}
