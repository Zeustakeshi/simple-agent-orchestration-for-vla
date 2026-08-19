"use client";
/* ToolCallBody — phần "agent đã thấy gì" của một tool call (MASTER §13.1).
 *
 * Tách khỏi `ToolCard` để hai chỗ cùng dùng được: dòng trong `AgentTrace` xổ ra
 * chính khối này, và `ToolCard` (khung riêng, dùng cho timeline P09) cũng render
 * nó. Trước đây nó nằm lồng trong `ToolCard`, nên muốn hiện chi tiết ở chỗ khác
 * thì phải kéo theo cả khung thẻ.
 *
 * Render theo TỪNG tool — không bao giờ đổ JSON thô — và chỉ từ những trường
 * backend thật sự trả về (MASTER §13.3). Thiếu trường thì ẩn phần tử, không
 * hiện `N/A`. */

import { useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import type { ToolCall, JointState } from "@/stores";
import { EpisodeProgress } from "./EpisodeProgress";
import { JointTable } from "@/components/robot-state/JointTable";
import { Lightbox, type ImageRef } from "@/components/common/Lightbox";
import { CopyableCode } from "@/components/common/CopyableCode";
import { errorText } from "@/lib/errors";
import { toolArgSummary, describeEdgeStatus } from "@/lib/tool-display";

/* ---------------------------------------------------------------- helpers */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Pull typed images out of an untyped tool result without inventing fields. */
function readImages(result: Record<string, unknown> | undefined): ImageRef[] {
  if (!result || !Array.isArray(result.images)) return [];
  return result.images.flatMap((raw): ImageRef[] => {
    if (!isRecord(raw) || typeof raw.url !== "string") return [];
    const camera = raw.camera === "wrist" ? "wrist" : "top";
    return [{
      id: typeof raw.id === "string" ? raw.id : raw.url,
      url: raw.url,
      camera,
      captured_at: typeof raw.captured_at === "string" ? raw.captured_at : "",
    }];
  });
}

function readJoints(result: Record<string, unknown> | undefined): JointState[] {
  if (!result || !Array.isArray(result.joints)) return [];
  return result.joints.flatMap((raw): JointState[] => {
    if (!isRecord(raw) || typeof raw.name !== "string") return [];
    return [{
      name: raw.name,
      present_position: typeof raw.present_position === "number" ? raw.present_position : 0,
      present_load: typeof raw.present_load === "number" ? raw.present_load : 0,
      torque_enabled: raw.torque_enabled === true,
      moving: raw.moving === true,
      error_flags: Array.isArray(raw.error_flags) ? raw.error_flags.filter((f): f is string => typeof f === "string") : [],
    }];
  });
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/* -------------------------------------------------------------- component */

interface ToolCallBodyProps {
  toolCall: ToolCall;
  /** Trang điều khiển truyền `true` để thanh episode mời được "Xem camera". */
  showCameraLink?: boolean;
}

export function ToolCallBody({ toolCall, showCameraLink }: ToolCallBodyProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const images = readImages(toolCall.result);
  const joints = readJoints(toolCall.result);

  return (
    <div className="space-y-3">
      {/* ---- capture_tool: what the robot saw */}
      {toolCall.tool_name === "capture_tool" && images.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setLightboxIndex(i)}
                className="relative aspect-video rounded-lg overflow-hidden focus-ring cursor-pointer group"
                aria-label={`Mở ảnh ${img.camera === "top" ? "camera trên" : "camera cổ tay"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- artifact URLs come from the backend at runtime */}
                <img
                  src={img.url}
                  alt={`Ảnh từ ${img.camera === "top" ? "camera trên" : "camera cổ tay"}`}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-1 left-1 data text-[10px] px-1.5 py-0.5 rounded bg-ink-950/80 text-paper-50">
                  {img.camera}
                </span>
              </button>
            ))}
          </div>
          <Lightbox
            images={images}
            index={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onIndexChange={setLightboxIndex}
          />
        </>
      )}

      {/* ---- get_robot_state: the measured numbers */}
      {toolCall.tool_name === "get_robot_state" && joints.length > 0 && <JointTable joints={joints} />}

      {/* ---- get_robot_state (edge_vla): không trả khớp, trả việc robot đang bận
              hay rảnh. Đó là thứ quyết định agent có gọi `take_action` được hay
              không, nên nó phải hiện ra chứ không nằm im trong JSON. */}
      {toolCall.tool_name === "get_robot_state" && joints.length === 0 && toolCall.result && (
        <p className="text-[12.5px] text-haze-300">
          {toolCall.result.busy === true ? "Robot đang bận với một thao tác khác." : "Robot đang rảnh, sẵn sàng nhận lệnh."}
          {typeof toolCall.result.retry_count === "number" && toolCall.result.retry_count > 0 && (
            <> Đã thử lại <span className="data">{String(toolCall.result.retry_count)}</span> lần.</>
          )}
        </p>
      )}

      {/* ---- check_status / check_success: kết cục của thao tác, bằng tiếng Việt */}
      {(toolCall.tool_name === "check_status" || toolCall.tool_name === "check_success") && toolCall.result && (
        <p className="text-[12.5px] text-haze-300">
          {toolCall.tool_name === "check_success"
            ? toolCall.result.success === true
              ? "Đã hoàn thành thành công."
              : "Chưa đạt yêu cầu."
            : describeEdgeStatus(toolCall.result)}
        </p>
      )}

      {/* ---- capture (edge_vla): ảnh bị `server/mcp_client.py` gỡ khỏi kết quả
              trước khi tới trình duyệt — chúng chỉ đi vào ngữ cảnh của LLM. Nói
              thẳng điều đó, thay vì để một thẻ tool rỗng khiến người dùng tưởng
              việc chụp đã hỏng. */}
      {toolCall.tool_name === "capture" && toolCall.status === "SUCCEEDED" && (
        <p className="text-[12.5px] text-haze-500">
          Đã chụp ảnh hiện trường và gửi cho agent. Xem khung camera bên phải để thấy hình trực tiếp.
        </p>
      )}

      {/* ---- take_action / go_home: the episode progress bar */}
      {(toolCall.tool_name === "take_action" || toolCall.tool_name === "go_home") &&
        (toolCall.episodes ?? []).map((ep) => (
          <EpisodeProgress
            key={ep.id}
            episode={ep}
            hideInstruction={toolCall.tool_name === "go_home"}
            showCameraLink={showCameraLink}
          />
        ))}

      {/* ---- stop_robot: one line, nothing more */}
      {toolCall.tool_name === "stop_robot" && toolCall.result && (
        <p className="text-[12.5px] text-haze-300">
          {typeof toolCall.result.stopped_at === "string" && (
            <>
              Đã dừng lúc{" "}
              <span className="data">
                {new Date(toolCall.result.stopped_at).toLocaleTimeString("vi-VN")}
              </span>
            </>
          )}
          {typeof toolCall.result.reason === "string" && <>, lý do: {String(toolCall.result.reason)}</>}
        </p>
      )}

      {/* ---- reset_error: which flags were cleared */}
      {toolCall.tool_name === "reset_error" && (
        <div className="flex flex-wrap gap-1.5">
          {readStrings(toolCall.result?.cleared_flags).map((flag) => (
            <span key={flag} className="data text-[11px] px-2 py-0.5 rounded bg-ink-700 text-haze-300">
              {flag}
            </span>
          ))}
        </div>
      )}

      {/* ---- health_check: component-by-component verdict */}
      {toolCall.tool_name === "health_check" && isRecord(toolCall.result?.components) && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(toolCall.result.components as Record<string, unknown>).map(([name, ok]) => (
            <span
              key={name}
              className={`inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11.5px] font-medium ${
                ok === true ? "bg-jade-400/15 text-jade-400" : "bg-halt-500/15 text-halt-500"
              }`}
            >
              {ok === true ? <Check size={11} /> : <TriangleAlert size={11} />}
              {name}
            </span>
          ))}
        </div>
      )}

      {/* ---- arguments, when there is something worth showing */}
      {toolArgSummary(toolCall) && toolCall.tool_name !== "take_action" && (
        <p className="text-[12px] text-haze-500">
          <span className="eyebrow mr-2">Tham số</span>
          <span className="data text-[11.5px]">{toolArgSummary(toolCall)}</span>
        </p>
      )}

      {/* ---- failure detail: message + copyable code */}
      {toolCall.status === "FAILED" && toolCall.error && (
        <div className="flex items-start gap-2 text-halt-500">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-[12.5px]">{errorText(toolCall.error)}</span>
            <CopyableCode value={toolCall.error.code} label="Mã lỗi" />
          </div>
        </div>
      )}

      {toolCall.status === "TIMEOUT" && (
        <p className="text-[12.5px] text-amber-400">
          Tool không phản hồi kịp. Thử lại hoặc kiểm tra kết nối của thiết bị Edge.
        </p>
      )}
    </div>
  );
}
