import { Sparkles, X } from 'lucide-react';
import type { RecipeId, Suggestion } from '../domain/recipes';

// A small, dismissible "what next?" strip: it only appears while the plan is
// untouched, and every chip just opens the draft preview — nothing is changed.
export function SuggestionBar({
  loose,
  items,
  onPick,
  onDismiss,
}: {
  loose: number;
  items: Suggestion[];
  onPick(id: RecipeId): void;
  onDismiss(): void;
}) {
  return (
    <div className="suggestion-bar" data-testid="suggestion-bar">
      <Sparkles size={15} />
      <span className="suggestion-text">
        这一层有 <strong>{loose}</strong> 个散放文件，先试试一键整理？
      </span>
      <div className="suggestion-chips">
        {items.map((item) => (
          <button className="chip" key={item.id} onClick={() => onPick(item.id)}>
            {item.title}
            <small>
              {item.id === 'stale' ? `${item.files} 个旧文件` : `${item.folders} 个文件夹`}
            </small>
          </button>
        ))}
      </div>
      <button className="icon-button" aria-label="暂不提示整理建议" onClick={onDismiss}>
        <X size={14} />
      </button>
    </div>
  );
}
