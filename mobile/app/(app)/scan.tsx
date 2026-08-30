import React, { useCallback, useState } from "react";
import { View, ScrollView, Image, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, Button, ProgressBar } from "@/src/components/ui";
import {
  presignUpload,
  completeUpload,
  checkDocument,
  type DocCheckResult,
} from "@/src/api/endpoints";

/**
 * Add a document.
 *
 * Capture → preview → upload → check → result, the four states the design
 * specifies, in one flow.
 *
 * ── Why the bytes do not go through the API ───────────────────────────────
 * `presign` returns a URL that points straight at object storage. The photo is
 * PUT there directly and the API is only told to go and validate it. A
 * multi-megabyte camera photo travelling through the API would hold a request
 * slot and a buffer for the length of the upload — tens of seconds on 3G — and
 * a handful of concurrent uploads would starve every other request.
 *
 * ── What the server does that this screen promises ────────────────────────
 * The server sniffs the real file type from its bytes, strips EXIF, and
 * generates a thumbnail before the document becomes readable. The EXIF strip is
 * the one worth surfacing to the user: a phone writes GPS coordinates into
 * every photo, so a picture of a passport page says where its owner was
 * standing. `metadata_stripped` comes back from the completion call and is
 * shown, because silently altering someone's file is worse than altering it
 * and saying so.
 */

const DOC_TYPES = [
  { key: "passport", label: "Passport" },
  { key: "national_id", label: "National ID" },
  { key: "bank_statement", label: "Bank statement" },
  { key: "acceptance_letter", label: "Admission letter" },
  { key: "transcript", label: "Transcript" },
  { key: "study_permit", label: "Study permit" },
  { key: "other", label: "Something else" },
];

type Stage = "choose" | "preview" | "uploading" | "checking" | "done";

export default function ScanScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [docType, setDocType] = useState("passport");
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [stage, setStage] = useState<Stage>("choose");
  const [progress, setProgress] = useState(0);
  const [stripped, setStripped] = useState<boolean | null>(null);
  const [check, setCheck] = useState<DocCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = useCallback(async (from: "camera" | "library") => {
    setError(null);

    const permission =
      from === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      // §40: explain why the permission is needed rather than failing silently.
      Alert.alert(
        from === "camera" ? "Camera access is off" : "Photo access is off",
        "GlobalBridge needs it to add a document. You can turn it on in your phone's settings.",
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      // Compressed before it leaves the phone. §3.8 assumes a 3G connection and
      // a metered plan; a 6 MB camera original costs the user real money to
      // send and gains nothing — the server caps at 15 MB regardless.
      quality: 0.75,
      allowsEditing: true,
      exif: false,
    };

    const result =
      from === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets[0]) return;
    setAsset(result.assets[0]);
    setStage("preview");
  }, []);

  const upload = useCallback(async () => {
    if (!asset) return;
    setStage("uploading");
    setProgress(0.1);
    setError(null);

    try {
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const contentType = asset.mimeType ?? "image/jpeg";

      const presigned = await presignUpload({
        type: docType,
        purpose: "document",
        content_type: contentType,
        size_bytes: blob.size,
        filename: asset.fileName ?? `${docType}.jpg`,
      });
      setProgress(0.35);

      // Straight to storage. The Content-Type must match exactly — it is signed
      // into the URL, so a different one is rejected by the bucket.
      const put = await fetch(presigned.upload_url, {
        method: "PUT",
        headers: presigned.headers,
        body: blob,
      });
      if (!put.ok) throw new Error("The upload did not complete.");
      setProgress(0.7);

      const completed = await completeUpload(presigned.document_id);
      setStripped(completed.metadata_stripped);
      setProgress(1);

      setStage("checking");
      try {
        const result = await checkDocument({
          docType,
          fileName: asset.fileName ?? undefined,
          fileSize: blob.size,
        });
        setCheck(result);
      } catch {
        // The document is stored either way. A failed check is not a failed
        // upload, and conflating them would make the user re-photograph a
        // passport that is already safely saved.
        setCheck(null);
      }
      setStage("done");
    } catch (err) {
      setError((err as { message?: string }).message ?? "We could not save that document.");
      setStage("preview");
    }
  }, [asset, docType]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.md,
        paddingBottom: space.xxl,
        gap: space.md,
      }}
    >
      <GBText variant="title">Add a document</GBText>

      {stage === "choose" || stage === "preview" ? (
        <View style={{ gap: space.sm }}>
          <GBText variant="label">What is it?</GBText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {DOC_TYPES.map((t) => {
              const active = t.key === docType;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setDocType(t.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={{
                    paddingHorizontal: space.md,
                    paddingVertical: 10,
                    borderRadius: radius.pill,
                    backgroundColor: active ? colors.claysoft : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? colors.clay : colors.border,
                  }}
                >
                  <GBText variant="small" style={{ color: active ? colors.clay6 : colors.ink6 }}>
                    {t.label}
                  </GBText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {asset ? (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <Image
            source={{ uri: asset.uri }}
            style={{ width: "100%", height: 240, backgroundColor: colors.alt }}
            resizeMode="contain"
            accessibilityLabel="The document you are about to upload"
          />
        </Card>
      ) : null}

      {stage === "choose" ? (
        <View style={{ gap: space.sm }}>
          <Button label="Take a photo" onPress={() => void pick("camera")} />
          <Button label="Choose from library" variant="secondary" onPress={() => void pick("library")} />
          <GBText variant="small" tone="subtle">
            Lay the page flat in even light. It does not have to be perfectly
            straight — we only need the text to be readable.
          </GBText>
        </View>
      ) : null}

      {stage === "preview" ? (
        <View style={{ gap: space.sm }}>
          <Card>
            <GBText variant="label">Before it is sent</GBText>
            <GBText variant="small" tone="subtle" style={{ marginTop: 4 }}>
              The photo is compressed on this phone, and the location data your
              camera recorded is removed on the server before the file is
              stored.
            </GBText>
          </Card>
          <Button label="Upload" onPress={() => void upload()} />
          <Button label="Retake" variant="secondary" onPress={() => setStage("choose")} />
        </View>
      ) : null}

      {stage === "uploading" || stage === "checking" ? (
        <Card>
          <GBText variant="label">
            {stage === "uploading" ? "Uploading" : "Checking the document"}
          </GBText>
          <View style={{ marginTop: space.sm }}>
            <ProgressBar percent={progress * 100} label="Upload progress" />
          </View>
          <GBText variant="small" tone="subtle" style={{ marginTop: space.sm }}>
            {stage === "uploading"
              ? "Sending straight to secure storage."
              : "Looking for the things that get applications rejected."}
          </GBText>
        </Card>
      ) : null}

      {error ? (
        <Card accent={colors.danger}>
          <GBText variant="small" tone="danger">
            {error}
          </GBText>
        </Card>
      ) : null}

      {stage === "done" ? (
        <View style={{ gap: space.sm }}>
          <Card accent={colors.clay}>
            <Badge label="Saved" tone="success" glyph="✓" />
            <GBText variant="body" style={{ marginTop: 6 }}>
              Your document is stored.
            </GBText>
            {stripped ? (
              <GBText variant="small" tone="subtle" style={{ marginTop: 4 }}>
                The location data from the photo was removed before storing.
              </GBText>
            ) : null}
          </Card>

          {check ? <CheckResult result={check} /> : (
            <Card>
              <GBText variant="small" tone="muted">
                The document is saved, but the checker could not run just now.
                You can run it again later from Documents.
              </GBText>
            </Card>
          )}

          <Button label="Back to documents" onPress={() => router.replace("/documents")} />
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * The check result.
 *
 * Every finding is phrased as something to verify, because the checker never
 * sees the file: it reasons about what governments commonly reject for this
 * document type. Rendering these as observations would be inventing facts about
 * someone's passport.
 */
function CheckResult({ result }: { result: DocCheckResult }) {
  const { colors, space } = useTheme();

  const tone = (severity: string) =>
    severity === "fail" ? colors.danger : severity === "warn" ? colors.amber : colors.clay6;

  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <GBText variant="heading" style={{ flex: 1 }}>
            {result.label}
          </GBText>
          {result.degraded ? <Badge label="Not checked" tone="warning" glyph="!" /> : null}
        </View>

        <GBText variant="small" tone="muted">
          {result.summary}
        </GBText>

        {result.findings.map((finding) => (
          <View
            key={finding.id}
            style={{
              flexDirection: "row",
              gap: space.sm,
              paddingTop: space.sm,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <GBText variant="tag" style={{ color: tone(finding.severity), width: 20 }}>
              {finding.severity === "ok" ? "✓" : finding.severity === "warn" ? "!" : "×"}
            </GBText>
            <View style={{ flex: 1, gap: 2 }}>
              <GBText variant="small">{finding.label}</GBText>
              <GBText variant="small" tone="subtle">
                {finding.detail}
              </GBText>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}
