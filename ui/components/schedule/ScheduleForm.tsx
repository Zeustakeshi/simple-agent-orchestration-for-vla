"use client";
/* ScheduleForm — P07
   Client-side validation is deliberately limited to two things: a non-empty
   name and a non-empty task prompt. Everything else (cron syntax, the 5-minute
   minimum gap) is the server's call, so the two can't drift. Submit errors are
   shown inline next to the field they belong to — never as a toast. */

import { useState, useCallback, useEffect } from "react";
import { Dialog } from "@/components/common/Dialog";
import { CronBuilder } from "./CronBuilder";
import { createSchedule, type CronValidation } from "@/lib/api/schedules";
import { fetchRobots } from "@/lib/api/robots";
import { errorText, toErrorObject } from "@/lib/errors";
import { useAuthStore, type Schedule } from "@/stores";

const OVERLAP_POLICIES: { value: Schedule["overlap_policy"]; label: string; hint: string }[] = [
  { value: "SKIP", label: "Bỏ qua lần này", hint: "An toàn nhất: nếu robot đang bận thì bỏ qua lượt chạy." },
  { value: "QUEUE", label: "Xếp hàng chờ", hint: "Chạy ngay sau khi nhiệm vụ hiện tại kết thúc." },
  { value: "FORCE_STOP", label: "Dừng nhiệm vụ đang chạy", hint: "Rủi ro: cắt ngang chuyển động đang diễn ra của robot." },
];

interface ScheduleFormProps {
  onClose: () => void;
  onSaved: (schedule: Schedule) => void;
}

export function ScheduleForm({ onClose, onSaved }: ScheduleFormProps) {
  const user = useAuthStore((s) => s.user);
  const timezone = user?.timezone ?? "Asia/Ho_Chi_Minh";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [robotId, setRobotId] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [cron, setCron] = useState("0 8 * * *");
  const [cronValidation, setCronValidation] = useState<CronValidation | null>(null);
  const [overlapPolicy, setOverlapPolicy] = useState<Schedule["overlap_policy"]>("SKIP");
  const [maxDuration, setMaxDuration] = useState(180);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /* Vẫn phải nạp danh sách để biết `robot_id` gửi lên là gì — chỉ là không
       hiện ra cho người dùng chọn nữa. Lấy con đầu tiên. */
    fetchRobots().then((rows) => {
      if (cancelled) return;
      setRobotId((current) => current || rows[0]?.id || "");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(async () => {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Nhập tên cho lịch chạy.";
    if (!taskPrompt.trim()) errors.taskPrompt = "Nhập nhiệm vụ cho agent.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const created = await createSchedule({
        name: name.trim(),
        description: description.trim(),
        robot_id: robotId,
        task_prompt: taskPrompt.trim(),
        cron_expression: cron,
        cron_description: cronValidation?.cron_description ?? "",
        timezone,
        overlap_policy: overlapPolicy,
        max_duration_s: maxDuration,
      });
      onSaved(created);
    } catch (err) {
      const error = toErrorObject(err);
      // Server-side field errors land next to their field (P07).
      const field =
        error.code === "SCHED_001" ? "name" : error.code === "SCHED_002" ? "cron" : "form";
      setFieldErrors({ [field]: errorText(error) });
    } finally {
      setSubmitting(false);
    }
  }, [name, description, robotId, taskPrompt, cron, cronValidation, timezone, overlapPolicy, maxDuration, onSaved]);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Tạo lịch chạy"
      className="!max-w-[640px]"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost focus-ring">
            Huỷ
          </button>
          <button type="button" onClick={submit} disabled={submitting} className="btn-primary focus-ring">
            {submitting ? "Đang lưu…" : "Lưu lịch chạy"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Một cột, không phải lưới hai cột: ô chọn robot đã bỏ nên "Tên lịch"
            đứng một mình, để nguyên lưới thì nó co lại còn nửa bề ngang cạnh
            một khoảng trống. */}
        <div>
          <label className="block">
            <span className="text-[13px] text-paper-50">Tên lịch</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Kiểm tra khay đầu ca"
              aria-invalid={Boolean(fieldErrors.name)}
              className="mt-1.5 w-full h-10 px-3 rounded-lg bg-ink-900 border border-[var(--line)] text-[13px] text-paper-50 placeholder:text-haze-500 focus:outline-none focus-ring"
            />
            {fieldErrors.name && <span className="block mt-1 text-[12px] text-halt-500">{fieldErrors.name}</span>}
          </label>

        </div>

        {/* KHÔNG có ô chọn robot. Sản phẩm vận hành đúng một cánh tay, nên bắt
            người dùng chọn trong danh sách một-lựa-chọn là hỏi một câu không có
            câu trả lời nào khác. `robotId` vẫn được điền tự động từ robot đầu
            tiên và vẫn gửi lên `robot_id` như cũ — chỉ là không hỏi nữa. */}

        <label className="block">
          <span className="text-[13px] text-paper-50">Mô tả</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tuỳ chọn"
            className="mt-1.5 w-full h-10 px-3 rounded-lg bg-ink-900 border border-[var(--line)] text-[13px] text-paper-50 placeholder:text-haze-500 focus:outline-none focus-ring"
          />
        </label>

        <label className="block">
          <span className="text-[13px] text-paper-50">Nhiệm vụ</span>
          <textarea
            rows={4}
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            placeholder="Viết như đang ra lệnh cho agent. VD: Kiểm tra khay linh kiện và sắp xếp lại theo màu."
            aria-invalid={Boolean(fieldErrors.taskPrompt)}
            className="mt-1.5 w-full p-3 rounded-lg bg-ink-900 border border-[var(--line)] text-[13px] text-paper-50 placeholder:text-haze-500 resize-none focus:outline-none focus-ring"
          />
          {fieldErrors.taskPrompt && (
            <span className="block mt-1 text-[12px] text-halt-500">{fieldErrors.taskPrompt}</span>
          )}
        </label>

        <div>
          <p className="text-[13px] text-paper-50 mb-2">Lịch chạy</p>
          <CronBuilder value={cron} onChange={setCron} onValidation={setCronValidation} timezone={timezone} />
          {fieldErrors.cron && <p className="mt-1 text-[12px] text-halt-500">{fieldErrors.cron}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[var(--line)]">
          <label className="block">
            <span className="text-[13px] text-paper-50">Múi giờ</span>
            <input
              type="text"
              value={timezone}
              readOnly
              className="mt-1.5 w-full h-10 px-3 rounded-lg bg-ink-900 border border-[var(--line)] data text-haze-500 focus:outline-none focus-ring"
            />
          </label>

          <label className="block">
            <span className="text-[13px] text-paper-50">
              Thời lượng tối đa <span className="data text-haze-500">{maxDuration}s</span>
            </span>
            <input
              type="range"
              min={60}
              max={300}
              step={10}
              value={maxDuration}
              onChange={(e) => setMaxDuration(Number(e.target.value))}
              className="mt-3 w-full accent-arc-500 focus-ring"
            />
          </label>
        </div>

        <fieldset>
          <legend className="text-[13px] text-paper-50 mb-2">Khi lịch chồng nhau</legend>
          <div className="space-y-1.5">
            {OVERLAP_POLICIES.map((policy) => (
              <label key={policy.value} className="flex items-start gap-2.5 cursor-pointer" title={policy.hint}>
                <input
                  type="radio"
                  name="overlap"
                  value={policy.value}
                  checked={overlapPolicy === policy.value}
                  onChange={() => setOverlapPolicy(policy.value)}
                  className="mt-1 accent-arc-500 focus-ring"
                />
                <span>
                  <span className="block text-[13px] text-paper-50">{policy.label}</span>
                  <span className={`block text-[12px] ${policy.value === "FORCE_STOP" ? "text-amber-400" : "text-haze-500"}`}>
                    {policy.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {fieldErrors.form && <p className="text-[12.5px] text-halt-500">{fieldErrors.form}</p>}
      </div>
    </Dialog>
  );
}
