import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { loadFromStorage, saveToStorage } from '../../utils/storage.js';

const storageKey = (id) => `orgpath_nav_group_${id}`;

/**
 * A menu section with an optional heading. With a `label` it can be collapsed, and the choice is
 * remembered per section. `forceOpen` keeps it open while the current page is inside it, without
 * overwriting what was saved. Without a `label` it is just a plain, always-visible list.
 */
export default function NavGroup({ id, label, defaultOpen = true, forceOpen = false, children }) {
  const regionId = useId();
  const [open, setOpen] = useState(() => {
    const saved = loadFromStorage(storageKey(id), defaultOpen);
    return typeof saved === 'boolean' ? saved : defaultOpen;
  });

  if (!label) return <div>{children}</div>;

  const shown = open || forceOpen;
  const toggle = () => {
    const next = !shown;
    setOpen(next);
    saveToStorage(storageKey(id), next);
  };

  return (
    <div>
      <button type="button" className="nav-group-header" onClick={toggle} aria-expanded={shown} aria-controls={regionId}>
        <span>{label}</span>
        {shown ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
      </button>
      <div id={regionId} hidden={!shown}>{shown ? children : null}</div>
    </div>
  );
}
