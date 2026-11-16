/** Stable project categories, shared by the workspace and design sidebar. */
export function projectTag(name: string): { color: string; label: string } {
  if (/巡检|检测|inspection/i.test(name))
    return { color: "#c58b5b", label: "巡检" };
  if (/配送|搬运|物流|移动|delivery|mobile/i.test(name))
    return { color: "#679887", label: "移动作业" };
  if (/机械臂|上料|操作|装配|manipulat/i.test(name))
    return { color: "#9685b7", label: "操作作业" };
  if (/仿真|导航|验证|simulat/i.test(name))
    return { color: "#7399b4", label: "仿真验证" };
  if (/部署|设备|deploy/i.test(name))
    return { color: "#b38c8c", label: "真机部署" };
  return { color: "#9ba27c", label: "设计项目" };
}
