// Privacy scan with Apple Vision (on-device): text (licence-plate candidates), people and faces per image.
//
// Build:  swiftc -O -o <bin>/vision_scan vision_scan.swift
// Usage:  vision_scan <imagesDir> <out.jsonl> [minTextHeight=0.004] [concurrency=4]
//
// One JSON object per image and line:
//   {"file": "...", "w": W, "h": H,
//    "text":   [{"box": [x0,y0,x1,y1], "s": "HOM AB 123", "c": 0.9}],   pixel coords, origin top-left
//    "humans": [{"box": [...], "c": 0.8}],  "faces": [{"box": [...], "c": 0.9}]}
// Images are only read (CGImageSource), never executed; the input folder is untrusted footage.
import CoreGraphics
import Foundation
import ImageIO
import Vision

let a = CommandLine.arguments
if a.count < 3 { print("usage: vision_scan <imagesDir> <out.jsonl> [minTextHeight] [concurrency]"); exit(2) }
let dir = URL(fileURLWithPath: a[1], isDirectory: true)
let outURL = URL(fileURLWithPath: a[2])
let minTextHeight = a.count > 3 ? Float(a[3]) ?? 0.004 : 0.004
let conc = a.count > 4 ? Int(a[4]) ?? 4 : 4

let files = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
  .filter { ["jpg", "jpeg", "png"].contains($0.pathExtension.lowercased()) }
  .sorted { $0.lastPathComponent < $1.lastPathComponent }

func px(_ r: CGRect, _ w: Int, _ h: Int) -> [Double] {
  // Vision: normalized, origin bottom-left -> pixels, origin top-left
  let x0 = Double(r.minX) * Double(w), x1 = Double(r.maxX) * Double(w)
  let y0 = (1 - Double(r.maxY)) * Double(h), y1 = (1 - Double(r.minY)) * Double(h)
  return [x0, y0, x1, y1].map { ($0 * 10).rounded() / 10 }
}

var results = [String](repeating: "", count: files.count)
let lock = NSLock()
let t0 = Date()
var done = 0

DispatchQueue.concurrentPerform(iterations: files.count) { i in
  autoreleasepool {
    let url = files[i]
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
      let img = CGImageSourceCreateImageAtIndex(src, 0, nil)
    else { return }
    let w = img.width, h = img.height
    let text = VNRecognizeTextRequest()
    text.recognitionLevel = .accurate
    text.usesLanguageCorrection = false
    text.recognitionLanguages = ["de-DE", "en-US"]
    text.minimumTextHeight = minTextHeight
    let humans = VNDetectHumanRectanglesRequest()
    humans.upperBodyOnly = false
    let faces = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cgImage: img, options: [:])
    do { try handler.perform([text, humans, faces]) } catch { print("error", url.lastPathComponent, error) }
    var rec: [String: Any] = ["file": url.lastPathComponent, "w": w, "h": h]
    rec["text"] = (text.results ?? []).compactMap { o -> [String: Any]? in
      guard let c = o.topCandidates(1).first else { return nil }
      return ["box": px(o.boundingBox, w, h), "s": c.string, "c": Double(c.confidence)]
    }
    rec["humans"] = (humans.results ?? []).map { ["box": px($0.boundingBox, w, h), "c": Double($0.confidence)] }
    rec["faces"] = (faces.results ?? []).map { ["box": px($0.boundingBox, w, h), "c": Double($0.confidence)] }
    let data = try! JSONSerialization.data(withJSONObject: rec, options: [.sortedKeys])
    lock.lock()
    results[i] = String(data: data, encoding: .utf8)!
    done += 1
    if done % 50 == 0 { print(String(format: "scanned %d/%d (%.0f s)", done, files.count, Date().timeIntervalSince(t0))) }
    lock.unlock()
  }
}
try results.filter { !$0.isEmpty }.joined(separator: "\n").appending("\n").write(to: outURL, atomically: true, encoding: .utf8)
print(String(format: "done %d images in %.0f s", files.count, Date().timeIntervalSince(t0)))
