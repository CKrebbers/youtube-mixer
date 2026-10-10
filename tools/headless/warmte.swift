import Foundation
let s = ProcessInfo.processInfo.thermalState
print(["nominal","fair","serious","critical"][s.rawValue])
