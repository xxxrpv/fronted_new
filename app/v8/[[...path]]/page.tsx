import { notFound } from "next/navigation";
import PreviewExperience from "../../../components/v8/PreviewExperience";
export default async function PreviewPage() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_V8_PREVIEW !== "1"
  )
    notFound();
  return <PreviewExperience />;
}
