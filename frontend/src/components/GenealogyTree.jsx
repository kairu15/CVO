import { Icon } from "./Icons";

/**
 * Offspring genealogy tree.
 *
 * Renders the multi-generation pass-on tree returned by the lineage endpoint
 * (`descendant_tree`): each node is a household that received this animal's
 * offspring, and its own offspring nest underneath it. A recursive nested
 * list, not a graph library — the programme's chains are shallow, and nested
 * lists stay printable, keyboard-navigable and screen-reader friendly.
 *
 * @param {object} props
 * @param {Array<object>} props.nodes tree nodes ({ name_of_farmer, children, … })
 */

function formatDate(value) {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function GenealogyTree({ nodes }) {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;

  return (
    <ul className="space-y-3">
      {nodes.map((node) => (
        <GenealogyNode key={node.event_id} node={node} />
      ))}
    </ul>
  );
}

function GenealogyNode({ node }) {
  const children = Array.isArray(node.children) ? node.children : [];

  return (
    <li>
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-display text-sm font-semibold text-slate-900">
            {node.name_of_farmer}
          </p>
          <span className="rounded-pill bg-brand-50 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-brand-800 uppercase">
            Generation {node.generation}
          </span>
        </div>

        <p className="mt-0.5 text-xs text-slate-500">
          {node.address} · {node.animal_type}
          {node.sex ? ` · ${node.sex === "M" ? "Male" : "Female"}` : ""}
        </p>

        <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-pill bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
          <Icon name="refresh" className="h-3 w-3" />
          Re-dispersed {formatDate(node.date_dispersed)}
        </p>

        {node.remarks && (
          <p className="mt-1.5 text-[11px] text-slate-500">{node.remarks}</p>
        )}
      </div>

      {children.length > 0 && (
        <ul className="mt-3 space-y-3 border-l-2 border-brand-200 pl-4 sm:pl-6">
          {children.map((child) => (
            <GenealogyNode key={child.event_id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}
