/* Mock robots — 6 variants covering all status combinations (MASTER §19) */
import { useRealtimeStore, type Robot, type JointState } from "@/stores";
import { mockDelay } from ".";

/* Dải giới hạn từng khớp của cánh tay 6 bậc tự do — tương ứng thẻ `range`
   trong file MJCF của MuJoCo. Vai và khuỷu bị chặn hẹp hơn cổ tay vì chúng
   mang tải; cổ tay xoay gần trọn vòng. */
const JOINT_LIMITS: Record<string, [min: number, max: number]> = {
  shoulder_pan: [-165, 165],
  shoulder_lift: [-110, 110],
  elbow: [-155, 155],
  wrist_1: [-180, 180],
  wrist_2: [-120, 120],
  wrist_3: [-180, 180],
};

/* `forcerange` của actuator từng khớp, N·m — MJCF khai trong <actuator>.
   Khớp gần gốc phải gánh cả cánh tay nên khoẻ hơn hẳn khớp cổ tay. */
const TORQUE_LIMITS: Record<string, number> = {
  shoulder_pan: 12,
  shoulder_lift: 12,
  elbow: 8,
  wrist_1: 4,
  wrist_2: 4,
  wrist_3: 3,
};

function makeJoints(healthy: boolean): JointState[] {
  const names = ["shoulder_pan", "shoulder_lift", "elbow", "wrist_1", "wrist_2", "wrist_3"];
  return names.map((name, i) => {
    const [range_min, range_max] = JOINT_LIMITS[name];
    const present_position = -30 + i * 25 + Math.random() * 10;
    // Sai số bám: bộ điều khiển luôn lệch một chút so với lệnh đặt. Đây chính
    // là con số nói lên khớp có theo kịp quỹ đạo hay không.
    const trackingError = (Math.random() - 0.5) * (healthy ? 0.8 : 4.5);
    return {
      name,
      present_position,
      target_position: present_position + trackingError,
      present_velocity: 0,
      // Khớp gần gốc gánh cả cánh tay nên mô-men lớn hơn hẳn khớp cổ tay.
      torque_nm: (6.5 - i * 0.9) * (healthy ? 0.4 + Math.random() * 0.3 : 0.9 + Math.random() * 0.4),
      torque_limit_nm: TORQUE_LIMITS[name],
      range_min,
      range_max,
      present_load: Math.random() * 40,
      torque_enabled: healthy,
      moving: false,
      error_flags: healthy ? [] : i === 2 ? ["OVERLOAD"] : [],
    };
  });
}

/** Pose đầu công tác — MuJoCo lấy từ `xpos`/`xquat` của site cuối chuỗi. */
function makeEndEffector() {
  return {
    position: { x: 0.312, y: -0.048, z: 0.276 },
    orientation: { roll: 178.4, pitch: -2.1, yaw: 46.7 },
    gripper: 0.35,
  };
}

const robotFixtures: Robot[] = [
  {
    id: "robot-001",
    name: "Cánh tay Alpha",
    model: "VLA-6X",
    robot_status: "IDLE",
    connection_status: "ONLINE",
    edge_version: "1.4.2",
    health: { has_error: false, error_flags: [] },
    capabilities: [
      { name: "capture_tool", version: "1.0" },
      { name: "get_robot_state", version: "1.0" },
      { name: "take_action", version: "2.1" },
      { name: "stop_robot", version: "1.0" },
      { name: "go_home", version: "1.0" },
      { name: "reset_error", version: "1.0" },
      { name: "health_check", version: "1.0" },
      { name: "get_task_status", version: "1.0" },
    ],
    joints: makeJoints(true),
    end_effector: makeEndEffector(),
    sim_time: 128.45,
  },
  {
    id: "robot-002",
    name: "Cánh tay Beta",
    model: "VLA-6X",
    robot_status: "BUSY",
    connection_status: "ONLINE",
    edge_version: "1.4.1",
    health: { has_error: false, error_flags: [] },
    capabilities: [
      { name: "capture_tool", version: "1.0" },
      { name: "get_robot_state", version: "1.0" },
      { name: "take_action", version: "2.1" },
      { name: "stop_robot", version: "1.0" },
      { name: "go_home", version: "1.0" },
      { name: "reset_error", version: "1.0" },
      { name: "health_check", version: "1.0" },
      { name: "get_task_status", version: "1.0" },
    ],
    joints: makeJoints(true),
  },
  {
    id: "robot-003",
    name: "Cánh tay Gamma",
    model: "VLA-6S",
    robot_status: "ERROR",
    connection_status: "ONLINE",
    edge_version: "1.3.8",
    health: { has_error: true, error_flags: ["OVERLOAD", "JOINT_LIMIT"] },
    capabilities: [
      { name: "capture_tool", version: "1.0" },
      { name: "get_robot_state", version: "1.0" },
      { name: "take_action", version: "2.0" },
      { name: "stop_robot", version: "1.0" },
      { name: "go_home", version: "1.0" },
      { name: "reset_error", version: "1.0" },
      { name: "health_check", version: "1.0" },
      { name: "get_task_status", version: "1.0" },
    ],
    joints: makeJoints(false),
  },
  {
    id: "robot-004",
    name: "Cánh tay Delta",
    model: "VLA-6X",
    robot_status: "STOPPING",
    connection_status: "ONLINE",
    edge_version: "1.4.2",
    health: { has_error: false, error_flags: [] },
    capabilities: [
      { name: "capture_tool", version: "1.0" },
      { name: "get_robot_state", version: "1.0" },
      { name: "take_action", version: "2.1" },
      { name: "stop_robot", version: "1.0" },
      { name: "go_home", version: "1.0" },
      { name: "reset_error", version: "1.0" },
      { name: "health_check", version: "1.0" },
      { name: "get_task_status", version: "1.0" },
    ],
    joints: makeJoints(true),
  },
  {
    id: "robot-005",
    name: "Cánh tay Epsilon",
    model: "VLA-6S",
    robot_status: "DISCONNECTED",
    connection_status: "ONLINE",
    edge_version: "1.2.0",
    health: { has_error: false, error_flags: [] },
    capabilities: [
      { name: "capture_tool", version: "1.0" },
      { name: "get_robot_state", version: "1.0" },
      { name: "take_action", version: "1.9" },
      { name: "stop_robot", version: "1.0" },
      { name: "go_home", version: "1.0" },
      { name: "reset_error", version: "1.0" },
      { name: "health_check", version: "1.0" },
      { name: "get_task_status", version: "1.0" },
    ],
    joints: makeJoints(true),
  },
  {
    id: "robot-006",
    name: "Cánh tay Zeta",
    model: "VLA-6X",
    robot_status: "IDLE",
    connection_status: "OFFLINE",
    edge_version: "1.4.0",
    health: { has_error: false, error_flags: [] },
    capabilities: [
      { name: "capture_tool", version: "1.0" },
      { name: "get_robot_state", version: "1.0" },
      { name: "take_action", version: "2.1" },
      { name: "stop_robot", version: "1.0" },
      { name: "go_home", version: "1.0" },
      { name: "reset_error", version: "1.0" },
      { name: "health_check", version: "1.0" },
      { name: "get_task_status", version: "1.0" },
    ],
    joints: makeJoints(true),
  },
];

/* Sản phẩm vận hành ĐÚNG MỘT robot (quyết định của nhóm), nên đội robot mà
   giao diện thấy chỉ có một phần tử. Năm bản ghi còn lại giữ nguyên làm bộ thử
   trạng thái: đổi hằng số dưới đây sang `robot-003` là cả giao diện chuyển sang
   nhánh ERROR, sang `robot-006` là nhánh OFFLINE — không phải sửa component nào.

   Vẫn để kiểu mảng thay vì một object: hợp đồng `GET /robots` của Cloud trả về
   danh sách, và mọi trạng thái rỗng/đang tải ở các trang đều dựng trên mảng. */
export const PRIMARY_ROBOT_ID = "robot-001";

export const mockRobots: Robot[] = robotFixtures.filter((r) => r.id === PRIMARY_ROBOT_ID);

/** Bộ 6 trạng thái đầy đủ — chỉ dùng để thử giao diện, không phải đội robot thật. */
export const robotStateFixtures = robotFixtures;

export function fetchMockRobots(): Promise<Robot[]> {
  return mockDelay(mockRobots, 0.03);
}

export function fetchMockRobot(id: string): Promise<Robot | undefined> {
  return mockDelay(robotFixtures.find((r) => r.id === id), 0.03);
}

/* ---------------------------------------------------------------- commands */

function findOrReject(id: string): Robot | null {
  return robotFixtures.find((r) => r.id === id) ?? null;
}

/** POST /robots/{id}/stop — the one command that must always be accepted.

    In mock mode this also pushes the state transitions the Cloud would send
    over SSE, so the badge and composer react exactly as they will in
    production: STOPPING immediately, IDLE once the Edge confirms. DOC 2 §9.1
    budgets ≤500ms from click to the IDLE badge. */
export function stopMockRobot(id: string): Promise<Robot> {
  const robot = findOrReject(id);
  if (!robot) return Promise.reject({ code: "ROBOT_011", message: "Không tìm thấy robot." });

  robot.robot_status = "STOPPING";
  const realtime = useRealtimeStore.getState();
  // Stopping the machine stops the run that is driving it.
  realtime.closeStream?.();
  const stoppedJoints = robot.joints.map((j) => ({ ...j, moving: false }));
  realtime.updateRobotState({
    robot_status: "STOPPING",
    connection_status: robot.connection_status,
    joints: stoppedJoints,
  });

  setTimeout(() => {
    if (robot.robot_status === "STOPPING") robot.robot_status = "IDLE";
    const store = useRealtimeStore.getState();
    store.updateRobotState({
      robot_status: "IDLE",
      connection_status: robot.connection_status,
      joints: stoppedJoints,
    });
    // Mirrors `episode.stopped` + `run.cancelled`: the banner shows briefly and
    // the composer comes back.
    if (store.runId !== null) {
      store.setEpisodeProgress(null);
      store.unlockComposer();
      store.setAgentStatus(null);
      store.setRunId(null);
      store.setBanner({ tone: "info", message: "Đã dừng theo yêu cầu." });
      setTimeout(() => useRealtimeStore.getState().setBanner(null), 3000);
    }
  }, 280);

  return mockDelay(robot, 0.02);
}

/** POST /robots/{id}/go-home */
export function goHomeMockRobot(id: string): Promise<Robot> {
  const robot = findOrReject(id);
  if (!robot) return Promise.reject({ code: "ROBOT_011", message: "Không tìm thấy robot." });
  if (robot.robot_status !== "IDLE") {
    return Promise.reject({ code: "ROBOT_010", message: "Robot đang bận." });
  }
  robot.robot_status = "BUSY";
  setTimeout(() => {
    robot.robot_status = "IDLE";
  }, 2500);
  return mockDelay(robot, 0.05);
}

/** POST /robots/{id}/reset-error — returns the flags that were cleared. */
export function resetMockRobotError(id: string): Promise<{ robot: Robot; cleared_flags: string[] }> {
  const robot = findOrReject(id);
  if (!robot) return Promise.reject({ code: "ROBOT_011", message: "Không tìm thấy robot." });
  const cleared = [...robot.health.error_flags];
  robot.health = { ...robot.health, has_error: false, error_flags: [] };
  robot.joints = robot.joints.map((j) => ({ ...j, error_flags: [] }));
  robot.robot_status = "IDLE";
  return mockDelay({ robot, cleared_flags: cleared }, 0.05);
}


/* Camera health shown on P10. In mock mode these are the values the backend
   would return; when USE_MOCK=0 the page hides the cards rather than
   inventing numbers (MASTER §13.3). */
export interface CameraHealth {
  camera: "top" | "wrist";
  fps: number;
  last_frame_age_s: number;
}

export function fetchMockCameraHealth(robotId: string): Promise<CameraHealth[]> {
  return mockDelay(
    robotId
      ? [
          { camera: "top" as const, fps: 15, last_frame_age_s: 1 },
          { camera: "wrist" as const, fps: 14, last_frame_age_s: 2 },
        ]
      : [],
    0.03,
  );
}

/** Thống kê lượt chạy cho trang Tổng quan (`RobotStats` ở `lib/api/robots.ts`).
    Cùng khoá STATUS_META của dashboard: COMPLETED/FAILED/TIMEOUT/CANCELLED.
    Nhịp theo ngày cố định (không random) — để hai lần mở trang không ra hai
    biểu đồ khác nhau. Cuối tuần thấp hẳn, đúng nhịp một phòng lab. */
export function fetchMockRobotStats(robotId: string, days = 14): Promise<RobotStatsShape | null> {
  if (!robotId) return mockDelay(null, 0);

  const daily_activity = [];
  let total_runs = 0;
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const count = weekend ? 1 : 6 + ((i * 7) % 9);
    total_runs += count;
    daily_activity.push({ date: date.toISOString().slice(0, 10), count });
  }

  const failed = Math.round(total_runs * 0.05);
  const timeout = Math.round(total_runs * 0.02);
  const cancelled = Math.round(total_runs * 0.01);
  const completed = total_runs - failed - timeout - cancelled;
  const finished_runs = completed + failed + timeout + cancelled;

  return mockDelay(
    {
      window_days: days,
      total_runs,
      finished_runs,
      success_rate: finished_runs > 0 ? completed / finished_runs : null,
      avg_duration_s: 14.6,
      outcomes: [
        { status: "COMPLETED", count: completed },
        { status: "FAILED", count: failed },
        { status: "TIMEOUT", count: timeout },
        { status: "CANCELLED", count: cancelled },
      ],
      daily_activity,
    },
    0.03,
  );
}

interface RobotStatsShape {
  window_days: number;
  total_runs: number;
  finished_runs: number;
  success_rate: number | null;
  avg_duration_s: number | null;
  outcomes: { status: string; count: number }[];
  daily_activity: { date: string; count: number }[];
}
