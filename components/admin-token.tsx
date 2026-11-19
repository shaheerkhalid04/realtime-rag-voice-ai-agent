"use client";

import { useState } from "react";
import { getAdminToken, setAdminToken } from "@/lib/api";

/** Owner-only field: the token that adding and removing documents requires. */
export function AdminToken() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  return (
    <details
      className="mx-auto mt-6 max-w-md rounded-lg border border-hairline px-4 py-3 text-left text-[13px]"
      // Read the stored token only when opened, so server and client render the same markup.
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open && !value) setValue(getAdminToken());
      }}
    >
      <summary className="cursor-pointer text-muted">Admin token, needed to add or remove documents</summary>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setAdminToken(value.trim());
          setSaved(true);
        }}
      >
        <input
          type="password"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
          }}
          placeholder="Paste ADMIN_TOKEN"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border border-hairline bg-transparent px-3 py-2"
        />
        <button type="submit" className="rounded-md border border-hairline px-3 py-2">
          Save
        </button>
        {saved && <span className="text-muted">Saved in this browser only.</span>}
      </form>
    </details>
  );
}
