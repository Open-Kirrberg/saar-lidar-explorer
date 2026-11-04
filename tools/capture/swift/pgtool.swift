// Apple Object Capture (RealityKit PhotogrammetrySession) CLI -- shared capture tool (from the Karlsberg
// video2world reference meshes).
//
// Build:  swiftc -O -o <bin>/pgtool pgtool.swift      (Command Line Tools are enough, no Xcode)
// Usage:  pgtool <imagesDir> <outDir> [detail[,detail...]] [sequential|unordered] [normal|high]
//         detail = preview|reduced|medium|full|raw; several details share one alignment (LODs in one run)
//
// Writes into <outDir>/:
//   model_<detail>/  OBJ + MTL + textures (a directory URL makes RealityKit write OBJ instead of USDZ)
//   poses.json    camera pose per input image (translation + rotation quaternion xyzw, mesh frame, Y-up arbitrary)
//   points.ply    point cloud (binary little-endian, x y z r g b) in the same frame as the mesh
//
// The mesh frame has arbitrary scale/orientation; georeferencing is done later (capture/georef.py).
import Foundation
import RealityKit

setvbuf(stdout, nil, _IOLBF, 0)  // line-buffered: progress shows up in run.log while it runs

let a = CommandLine.arguments
print("isSupported =", PhotogrammetrySession.isSupported,
      "maxImages =", PhotogrammetrySession.limits.maximumNumberOfInputImages)
if a.count < 3 { print("usage: pgtool <imagesDir> <outDir> [detail] [sequential|unordered] [normal|high]"); exit(2) }

let input = URL(fileURLWithPath: a[1], isDirectory: true)
let outDir = URL(fileURLWithPath: a[2], isDirectory: true)
let details: [String: PhotogrammetrySession.Request.Detail] =
  ["preview": .preview, "reduced": .reduced, "medium": .medium, "full": .full, "raw": .raw]
let wanted = (a.count > 3 ? a[3] : "full").split(separator: ",").map(String.init)
var modelRequests: [PhotogrammetrySession.Request] = []
for d in wanted {
  guard let detail = details[d] else { print("unknown detail", d); exit(2) }
  let dir = outDir.appendingPathComponent("model_\(d)", isDirectory: true)
  try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  modelRequests.append(.modelFile(url: dir, detail: detail))
}

var cfg = PhotogrammetrySession.Configuration()
cfg.sampleOrdering = (a.count > 4 && a[4] == "unordered") ? .unordered : .sequential
cfg.featureSensitivity = (a.count > 5 && a[5] == "normal") ? .normal : .high
cfg.isObjectMaskingEnabled = false   // a site, not a turntable object
cfg.ignoreBoundingBox = true

func writePoses(_ p: PhotogrammetrySession.Poses) {
  var rows: [[String: Any]] = []
  for (id, pose) in p.posesBySample.sorted(by: { $0.key < $1.key }) {
    let q = pose.rotation.vector
    rows.append([
      "id": id,
      "file": p.urlsBySample[id]?.lastPathComponent ?? "",
      "t": [pose.translation.x, pose.translation.y, pose.translation.z].map { Double($0) },
      "q_xyzw": [q.x, q.y, q.z, q.w].map { Double($0) },
    ])
  }
  let data = try! JSONSerialization.data(withJSONObject: ["poses": rows], options: [.prettyPrinted])
  try! data.write(to: outDir.appendingPathComponent("poses.json"))
  print("poses:", rows.count)
}

func writePly(_ pc: PhotogrammetrySession.PointCloud) {
  var d = Data()
  let header = "ply\nformat binary_little_endian 1.0\nelement vertex \(pc.points.count)\n" +
    "property float x\nproperty float y\nproperty float z\n" +
    "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
  d.append(header.data(using: .ascii)!)
  for pt in pc.points {
    var xyz = [pt.position.x, pt.position.y, pt.position.z]
    d.append(Data(bytes: &xyz, count: 12))
    d.append(contentsOf: [pt.color.x, pt.color.y, pt.color.z])
  }
  try! d.write(to: outDir.appendingPathComponent("points.ply"))
  print("points:", pc.points.count)
}

let session = try PhotogrammetrySession(input: input, configuration: cfg)
let t0 = Date()
Task {
  var lastPct = -10.0
  for try await out in session.outputs {
    switch out {
    case .requestProgress(_, let f):
      if f * 100 - lastPct >= 10 { lastPct = f * 100; print(String(format: "progress %.0f%% (%.0f s)", f * 100, Date().timeIntervalSince(t0))) }
    case .requestComplete(_, let r):
      switch r {
      case .poses(let p): writePoses(p)
      case .pointCloud(let pc): writePly(pc)
      case .modelFile(let u): print("model:", u.path)
      default: print("complete:", r)
      }
    case .requestError(let req, let e): print("error:", req, e)
    case .invalidSample(let id, let why): print("invalid sample", id, why)
    case .skippedSample(let id): print("skipped sample", id)
    case .automaticDownsampling: print("automatic downsampling")
    case .processingComplete:
      print(String(format: "done in %.0f s", Date().timeIntervalSince(t0))); exit(0)
    default: break
    }
  }
}
try session.process(requests: [.poses, .pointCloud] + modelRequests)
RunLoop.main.run()
