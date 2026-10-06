"use client";
import { siteCopy as t } from "@crm/public-site/content";
import {
  ArrowRight,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  GitBranch,
  ListTodo,
  LockKeyhole,
  Mail,
  MessageSquare,
  MousePointer2,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { GravityMark } from "../gravity-logo";

const views = ["actions", "sequences", "overview"] as const;
const icons = {
  actions: ListTodo,
  sequences: GitBranch,
  overview: ChartNoAxesCombined,
};
export function ProductTour() {
  const id = useId();
  const [view, setView] = useState<(typeof views)[number]>("actions");
  const [product, setProduct] = useState("");
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const task = t.previewTasks[selected];
  const tasks = t.previewTasks
    .map((item, index) => ({ ...item, index }))
    .filter((item) => product === "" || item.product === Number(product));
  return (
    <section className="site-tour-section" aria-label={t.tourLabel}>
      <div className="site-tour-heading">
        <div>
          <h2>{t.tourTitle}</h2>
          <p>{t.tourDescription}</p>
        </div>
        <MousePointer2 size={20} aria-hidden="true" />
      </div>
      <div className="site-preview site-tour">
        <div className="site-preview-bar">
          <GravityMark size={22} />
          <strong>{t.previewOrg}</strong>
          <label className="sr-only" htmlFor={`${id}-product`}>
            {t.product}
          </label>
          <select
            id={`${id}-product`}
            value={product}
            onChange={(event) => {
              const value = event.target.value;
              setProduct(value);
              if (value !== "")
                setSelected(
                  t.previewTasks.findIndex(
                    (item) => item.product === Number(value),
                  ),
                );
            }}
          >
            <option value="">{t.tourAllProducts}</option>
            {t.tourProducts.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="site-tour-tabs" role="tablist" aria-label={t.tourTitle}>
          {views.map((value, index) => {
            const Icon = icons[value];
            return (
              <button
                key={value}
                type="button"
                role="tab"
                ref={(node) => {
                  tabs.current[index] = node;
                }}
                id={`${id}-${value}-tab`}
                aria-controls={`${id}-${value}-panel`}
                aria-selected={view === value}
                tabIndex={view === value ? 0 : -1}
                onClick={() => setView(value)}
                onKeyDown={(event) => {
                  let next: number;
                  if (event.key === "ArrowRight")
                    next = (index + 1) % views.length;
                  else if (event.key === "ArrowLeft")
                    next = (index + views.length - 1) % views.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = views.length - 1;
                  else return;
                  event.preventDefault();
                  setView(views[next]);
                  tabs.current[next]?.focus();
                }}
              >
                <Icon size={16} aria-hidden="true" />
                {t.tourTabs[value]}
              </button>
            );
          })}
        </div>
        <div
          role="tabpanel"
          id={`${id}-${view}-panel`}
          aria-labelledby={`${id}-${view}-tab`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tab panels provide a keyboard focus target for read-only content.
          tabIndex={0}
          className="site-tour-panel"
          key={`${view}-${product}`}
        >
          {view === "actions" ? (
            <div className="site-preview-body">
              <div className="site-preview-list">
                <h3>{t.previewQueue}</h3>
                <small>
                  {t.previewToday} · {tasks.length}
                </small>
                {tasks.map((item) => (
                  <button
                    type="button"
                    className={`site-preview-task ${selected === item.index ? "selected" : ""}`}
                    key={item.name}
                    aria-pressed={selected === item.index}
                    onClick={() => setSelected(item.index)}
                  >
                    <span className="site-preview-avatar" aria-hidden="true">
                      {item.name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")}
                    </span>
                    <span className="site-tour-person">
                      <strong>{item.name}</strong>
                      <span>{item.company}</span>
                      <span className="site-tour-action">{item.task}</span>
                      <small>
                        {t.tourProducts[item.product]} · {item.label}
                      </small>
                    </span>
                    <span className="site-tour-due">
                      {item.time}
                      <ChevronRight size={14} aria-hidden="true" />
                    </span>
                  </button>
                ))}
              </div>
              <aside className="site-preview-context" key={selected}>
                <span className="site-eyebrow">{t.previewContext}</span>
                <h3>{task.name}</h3>
                <span className="site-badge">
                  {t.tourProducts[task.product]}
                </span>
                <div className="site-tour-message">
                  <Mail size={16} aria-hidden="true" />
                  <small>{t.tourPrivate}</small>
                  <blockquote>{task.context}</blockquote>
                </div>
                <p>{task.history}</p>
                <div className="site-tour-next">
                  <Check size={16} aria-hidden="true" />
                  <span>
                    <small>{t.tourNextStep}</small>
                    <strong>{task.task}</strong>
                  </span>
                </div>
              </aside>
            </div>
          ) : view === "sequences" ? (
            <div className="site-tour-sequence">
              <div>
                <span className="site-eyebrow">
                  {product === ""
                    ? t.tourAllProducts
                    : t.tourProducts[Number(product)]}
                </span>
                <h3>{t.tourSequence}</h3>
                <p>{t.tourSequenceNote}</p>
              </div>
              <ol>
                {t.tourSteps.map((step, index) => (
                  <li key={step}>
                    <span className="site-tour-step">{index + 1}</span>
                    <span>
                      <small>
                        {t.tourStep} {index + 1} · {index * 3} {t.tourDays}
                      </small>
                      <strong>{step}</strong>
                    </span>
                    <Mail size={16} aria-hidden="true" />
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="site-tour-overview">
              <p>{t.tourMetricNote}</p>
              <div>
                {t.tourMetricLabels.map((metric, index) => (
                  <button
                    type="button"
                    key={metric}
                    onClick={() => {
                      setView("actions");
                      tabs.current[0]?.focus();
                    }}
                  >
                    <small>{metric}</small>
                    <strong>{t.tourMetricValues[index]}</strong>
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <div className="site-tour-pipelines">
                {t.tourProducts
                  .filter(
                    (_, index) => product === "" || index === Number(product),
                  )
                  .map((name) => (
                    <button
                      type="button"
                      key={name}
                      onClick={() => {
                        setView("sequences");
                        tabs.current[1]?.focus();
                      }}
                    >
                      <GitBranch size={16} aria-hidden="true" />
                      <span>{name}</span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
        {views
          .filter((value) => value !== view)
          .map((value) => (
            <div
              key={value}
              role="tabpanel"
              id={`${id}-${value}-panel`}
              aria-labelledby={`${id}-${value}-tab`}
              hidden
            />
          ))}
        <div className="site-preview-caption">
          <LockKeyhole size={14} aria-hidden="true" />
          <span>{t.previewHistory}</span>
          <MessageSquare size={14} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
