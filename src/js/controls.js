// Thanh trượt điều chỉnh dùng chung cho thiết lập toàn ảnh, vùng chọn và phân màu.
//  - Nhấp đúp vào nhãn hoặc thanh trượt: đặt lại về mặc định.
//  - Shift + kéo: chỉnh tinh (1/5 tốc độ). Shift + mũi tên: bước ×10.
//  - Cuộn chuột khi thanh trượt đang được chọn (focus): tăng/giảm.
//  - Mỗi thao tác (kéo, gõ số, phím) tạo đúng một bước lịch sử.

export function setRangeProgress(range) {
  const min = Number(range.min), max = Number(range.max), value = Number(range.value);
  const pct = ((value - min) / (max - min)) * 100;
  range.style.setProperty("--range-progress", `${pct}%`);
  // Thanh có tâm ở giữa (min < 0 < max) tô từ tâm ra
  if (min < 0 && max > 0) {
    const zero = ((0 - min) / (max - min)) * 100;
    range.style.setProperty("--range-from", `${Math.min(zero, pct)}%`);
    range.style.setProperty("--range-to", `${Math.max(zero, pct)}%`);
  } else {
    range.style.setProperty("--range-from", "0%");
    range.style.setProperty("--range-to", `${pct}%`);
  }
}

const decimalsOf = (control) => control.decimals ?? (String(control.step).split(".")[1]?.length || 0);
export const formatValue = (control, value) => {
  const d = decimalsOf(control);
  const n = Number(value);
  const text = n.toFixed(d);
  return n > 0 && control.min < 0 ? `+${text}` : text;
};

/**
 * @param {HTMLElement} container
 * @param {object[]} controls
 * @param {{ key: (c)=>string, get: (c)=>number, set: (c, v)=>void, begin: ()=>void, commit: ()=>void, enabled?: ()=>boolean }} binding
 */
export function buildControls(container, controls, binding) {
  const rows = new Map();
  for (const control of controls) {
    const key = binding.key(control);
    const initial = control.initial ?? 0;
    const row = document.createElement("div");
    row.className = "control-row";
    const label = document.createElement("label");
    label.htmlFor = `${key}Range`;
    label.textContent = control.label;
    label.title = "Nhấp đúp để đặt lại";
    const range = document.createElement("input");
    range.type = "range";
    range.id = `${key}Range`;
    range.min = control.min;
    range.max = control.max;
    range.step = control.step;
    range.value = initial;
    if (control.gradient) {
      range.classList.add("color-track");
      range.style.setProperty("--track-background", control.gradient);
    }
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.className = "control-value";
    input.id = `${key}Value`;
    input.value = formatValue(control, initial);
    input.setAttribute("aria-label", `Giá trị ${control.label}`);

    let active = false;
    const begin = () => { if (!active) { active = true; binding.begin(control); } };
    const commit = () => { if (active) { active = false; binding.commit(control); } };
    const clampValue = (raw) => {
      const n = Number(String(raw).replace(",", "."));
      if (!Number.isFinite(n)) return binding.get(control);
      const stepped = Math.round(n / control.step) * control.step;
      return Math.min(control.max, Math.max(control.min, Number(stepped.toFixed(4))));
    };
    const apply = (raw) => {
      const value = clampValue(raw);
      binding.set(control, value);
      sync(value);
    };
    const sync = (value) => {
      range.value = value;
      if (document.activeElement !== input) input.value = formatValue(control, value);
      setRangeProgress(range);
      row.classList.toggle("changed", Math.abs(value - initial) > 1e-9);
    };
    const reset = () => { begin(); apply(initial); commit(); };

    // Kéo thường dùng hành vi gốc của input range; Shift + kéo = chỉnh tinh.
    let fine = null;
    range.addEventListener("pointerdown", (event) => {
      begin();
      if (event.shiftKey) {
        event.preventDefault();
        range.focus();
        range.setPointerCapture(event.pointerId);
        fine = { x: event.clientX, value: Number(range.value), width: range.getBoundingClientRect().width };
      }
    });
    range.addEventListener("pointermove", (event) => {
      if (!fine) return;
      const delta = ((event.clientX - fine.x) / fine.width) * (control.max - control.min) * 0.2;
      apply(fine.value + delta);
    });
    const endPointer = () => { fine = null; commit(); };
    range.addEventListener("pointerup", endPointer);
    range.addEventListener("pointercancel", endPointer);
    range.addEventListener("input", () => { begin(); apply(range.value); });
    range.addEventListener("change", commit);
    range.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      begin();
      const dir = ["ArrowRight", "ArrowUp", "PageUp"].includes(event.key) ? 1 : -1;
      if (event.key === "Home") apply(control.min);
      else if (event.key === "End") apply(control.max);
      else apply(Number(range.value) + dir * control.step * (event.shiftKey || event.key.startsWith("Page") ? 10 : 1));
    });
    range.addEventListener("keyup", commit);
    range.addEventListener("blur", commit);
    range.addEventListener("wheel", (event) => {
      if (document.activeElement !== range) return;
      event.preventDefault();
      begin();
      apply(Number(range.value) - Math.sign(event.deltaY) * control.step * (event.shiftKey ? 10 : 1));
      clearTimeout(range._wheelTimer);
      range._wheelTimer = setTimeout(commit, 350);
    }, { passive: false });
    range.addEventListener("dblclick", reset);
    label.addEventListener("dblclick", (event) => { event.preventDefault(); reset(); });

    input.addEventListener("focus", () => { input.select(); });
    input.addEventListener("change", () => { begin(); apply(input.value); commit(); input.value = formatValue(control, binding.get(control)); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { input.blur(); }
      if (event.key === "Escape") { input.value = formatValue(control, binding.get(control)); input.blur(); }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        begin();
        apply(binding.get(control) + (event.key === "ArrowUp" ? 1 : -1) * control.step * (event.shiftKey ? 10 : 1));
        input.value = formatValue(control, binding.get(control));
        commit();
      }
    });
    input.addEventListener("dblclick", reset);
    input.addEventListener("blur", () => { input.value = formatValue(control, binding.get(control)); });

    row.append(label, range, input);
    container.appendChild(row);
    setRangeProgress(range);
    rows.set(control.id, { row, range, input, sync, control });
  }
  return {
    rows,
    sync() {
      for (const { sync, control } of rows.values()) sync(binding.get(control));
    },
  };
}
