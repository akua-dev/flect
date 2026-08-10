import AppKit

@_cdecl("flect_macos_system_accent_rgba")
public func flectMacOSSystemAccentRGBA() -> UInt32 {
    let fallback = NSColor.systemBlue
    let color = NSColor.controlAccentColor.usingColorSpace(.sRGB) ?? fallback
    let red = UInt32(max(0, min(255, Int((color.redComponent * 255).rounded()))))
    let green = UInt32(max(0, min(255, Int((color.greenComponent * 255).rounded()))))
    let blue = UInt32(max(0, min(255, Int((color.blueComponent * 255).rounded()))))
    let alpha = UInt32(max(0, min(255, Int((color.alphaComponent * 255).rounded()))))
    return (red << 24) | (green << 16) | (blue << 8) | alpha
}
