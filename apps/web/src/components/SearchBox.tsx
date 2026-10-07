import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useStockSearch } from "../api/queries";
import { displayName } from "../lib/catalog";
import { useDebounced } from "../lib/use-debounced";
import { SearchIcon } from "./Icons";

const RESULT_LIMIT = 8;

export function SearchBox() {
  const navigate = useNavigate();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = useDebounced(text.trim(), 180);
  const search = useStockSearch(
    query,
    1,
    RESULT_LIMIT,
    open && query.length > 0,
  );
  const results = query ? (search.data?.items ?? []) : [];

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest(
        "input, textarea, [contenteditable='true']",
      );
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(symbol: string) {
    setText("");
    setOpen(false);
    inputRef.current?.blur();
    navigate(`/app/stocks/${encodeURIComponent(symbol)}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) =>
        Math.min(index + 1, Math.max(results.length - 1, 0)),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      go(results[active].symbol);
    } else if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showList = open && query.length > 0;

  return (
    <div className="search">
      <div className="search-box">
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          value={text}
          placeholder="Search 100 NSE stocks…"
          aria-label="Search stocks"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && results[active] ? `${listId}-${active}` : undefined
          }
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />
        {!text && <kbd aria-hidden>/</kbd>}
      </div>
      {showList && (
        <ul className="search-results" id={listId} role="listbox">
          {results.map((item, index) => (
            <li
              key={item.symbol}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                go(item.symbol);
              }}
            >
              <span>{item.symbol}</span>
              <span className="name">{displayName(item.symbol)}</span>
            </li>
          ))}
          {results.length === 0 && (
            <li
              className="empty"
              role="option"
              aria-selected={false}
              aria-disabled
            >
              {search.isFetching
                ? "Searching…"
                : `No match for “${query}” in the 100 listed stocks`}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
