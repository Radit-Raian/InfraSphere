// WebGL2 renderer. For every screen pixel it works out which direction of the sky you are
// looking at (for your place and time) and reads that spot from the SPHEREx all-sky image.
// A second, detailed "patch" image can be blended on top where you are zoomed in.

const VS = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uFov, uAz, uAlt, uLat, uLst, uExpo, uGam;
uniform int uProj;
uniform bool uGround, uGrid, uEqGrid, uGalGrid, uHasSky, uFlip, uHasPatch;
uniform vec3 uPatchInfo;
uniform sampler2D uSky;
uniform sampler2D uPatch;
out vec4 outColor;
const float PI = 3.14159265358979;

// Lines of constant longitude and latitude (all angles in degrees).
// Longitude lines are measured on the sphere (scaled by cos latitude) and fade out near the
// poles, where they would otherwise crowd into a solid blob.
float gridLines(float lonD, float latD, float lonStep, float latStep, float pw) {
  float cl = cos(latD * PI / 180.0);
  float dLat = abs(fract(latD / latStep + 0.5) - 0.5) * latStep;
  float dLon = abs(fract(lonD / lonStep + 0.5) - 0.5) * lonStep * cl;
  float lonLine = (1.0 - smoothstep(0.0, 1.3 * pw, dLon)) * smoothstep(2.0 * pw, 4.0 * pw, lonStep * cl);
  float latLine = 1.0 - smoothstep(0.0, 1.3 * pw, dLat);
  return max(lonLine, latLine);
}

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y);
  vec3 f = vec3(cos(uAlt) * cos(uAz), cos(uAlt) * sin(uAz), sin(uAlt));
  vec3 r = vec3(-sin(uAz), cos(uAz), 0.0);
  vec3 u = vec3(-sin(uAlt) * cos(uAz), -sin(uAlt) * sin(uAz), cos(uAlt));
  float rq = length(q);
  vec3 qv = r * q.x + u * q.y;
  vec3 d;
  if (uProj == 0) {
    float rr = rq * 2.0 * tan(uFov / 4.0);
    float th = 2.0 * atan(rr / 2.0);
    vec3 dirv = rq > 1e-6 ? qv / rq : vec3(0.0);
    d = f * cos(th) + dirv * sin(th);
  } else {
    d = normalize(f + qv * tan(uFov / 2.0));
  }

  // (north, east, up) -> hour angle / declination -> right ascension
  float cl = cos(uLat), sl = sin(uLat);
  float xH = d.z * cl - d.x * sl;
  float yH = -d.y;
  float zH = d.z * sl + d.x * cl;
  float H = atan(yH, xH);
  float dec = asin(clamp(zH, -1.0, 1.0));
  float raU = uLst - H;
  float ra = mod(raU + PI, 2.0 * PI) - PI;
  float sx = uFlip ? 0.5 + ra / (2.0 * PI) : 0.5 - ra / (2.0 * PI);
  vec2 uv = vec2(sx, 0.5 - dec / PI);

  vec3 sky = vec3(0.02, 0.012, 0.03);
  if (uHasSky) {
    vec3 c = texture(uSky, uv).rgb;
    if (uHasPatch) {
      float ra0 = uPatchInfo.x, dec0 = uPatchInfo.y, F = uPatchInfo.z;
      float dra = raU - ra0;
      float cosc = sin(dec0) * sin(dec) + cos(dec0) * cos(dec) * cos(dra);
      if (cosc > 0.2) {
        float xi = cos(dec) * sin(dra) / cosc;
        float eta = (cos(dec0) * sin(dec) - sin(dec0) * cos(dec) * cos(dra)) / cosc;
        vec2 pu = vec2(0.5 - xi / F, 0.5 - eta / F);
        float e = min(min(pu.x, 1.0 - pu.x), min(pu.y, 1.0 - pu.y));
        if (e > 0.0) c = mix(c, texture(uPatch, pu).rgb, smoothstep(0.0, 0.04, e));
      }
    }
    sky = pow(max(c * uExpo, 0.0), vec3(1.0 / uGam));
  }

  float pw = length(vec2(length(dFdx(d)), length(dFdy(d)))) * 180.0 / PI; // degrees per pixel
  pw = max(pw, 1e-4);

  if (uGrid) {
    float altD = asin(clamp(d.z, -1.0, 1.0)) * 180.0 / PI;
    float azD = atan(d.y, d.x) * 180.0 / PI;
    float da = abs(fract(altD / 15.0 + 0.5) - 0.5) * 15.0;
    float dz = abs(fract(azD / 30.0 + 0.5) - 0.5) * 30.0 * cos(asin(clamp(d.z, -1.0, 1.0)));
    float line = max(1.0 - smoothstep(0.0, 1.3 * pw, da), 1.0 - smoothstep(0.0, 1.3 * pw, dz));
    sky = mix(sky, vec3(0.45, 0.55, 0.95), line * 0.28);
  }

  if (uEqGrid) {
    // Equatorial (J2000): RA every 15 deg (1 h), Dec every 15 deg. The celestial equator is brighter.
    float raD = degrees(raU);
    float decD = degrees(dec);
    float line = gridLines(raD, decD, 15.0, 15.0, pw);
    float eqLine = 1.0 - smoothstep(0.0, 1.6 * pw, abs(decD));
    sky = mix(sky, vec3(0.30, 0.85, 0.60), max(line * 0.30, eqLine * 0.55));
  }

  if (uGalGrid) {
    // Galactic: rotate the equatorial direction into galactic axes (standard J2000 matrix).
    vec3 e = vec3(cos(dec) * cos(raU), cos(dec) * sin(raU), sin(dec));
    vec3 g = vec3(
      dot(e, vec3(-0.0548755604, -0.8734370902, -0.4838350155)),
      dot(e, vec3( 0.4941094279, -0.4448296300,  0.7469822445)),
      dot(e, vec3(-0.8676661490, -0.1980763734,  0.4559837762)));
    float lD = degrees(atan(g.y, g.x));
    float bD = degrees(asin(clamp(g.z, -1.0, 1.0)));
    float line = gridLines(lD, bD, 30.0, 15.0, pw);
    float planeLine = 1.0 - smoothstep(0.0, 1.6 * pw, abs(bD));
    sky = mix(sky, vec3(0.98, 0.65, 0.25), max(line * 0.30, planeLine * 0.55));
  }

  vec3 col = sky;
  if (uGround) {
    float k = smoothstep(-0.0025, 0.0025, d.z);
    float depth = clamp(-d.z, 0.0, 1.0);
    vec3 ground = mix(vec3(0.075, 0.055, 0.06), vec3(0.025, 0.018, 0.022), smoothstep(0.0, 0.5, depth));
    col = mix(ground, sky, k);
    float hl = 1.0 - smoothstep(0.0, 1.6 * pw, abs(asin(clamp(d.z, -1.0, 1.0)) * 180.0 / PI));
    col = mix(col, vec3(0.95, 0.5, 0.6), hl * 0.55);
  }
  outColor = vec4(col, 1.0);
}`;

export class SkyRenderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: false });
    if (!gl) throw new Error("This browser does not support WebGL2, which InfraSphere needs. Try a recent Chrome, Edge, Firefox or Safari.");
    this.gl = gl;
    this.canvas = canvas;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.hasSky = false;
    this.hasPatch = false;
    this.patch = { ra: 0, dec: 0, fov: 0 };

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("Shader error: " + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("Could not link shader: " + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;

    this.U = {};
    ["uRes", "uFov", "uAz", "uAlt", "uLat", "uLst", "uExpo", "uGam", "uProj", "uGround", "uGrid", "uEqGrid", "uGalGrid",
      "uHasSky", "uFlip", "uSky", "uPatch", "uPatchInfo", "uHasPatch"]
      .forEach((n) => { this.U[n] = gl.getUniformLocation(prog, n); });
    gl.bindVertexArray(gl.createVertexArray());

    this.skyTex = this._makeTexture(gl.TEXTURE0, gl.REPEAT);
    this.patchTex = this._makeTexture(gl.TEXTURE1, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.U.uSky, 0);
    gl.uniform1i(this.U.uPatch, 1);
  }

  _makeTexture(unit, wrapS) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    return t;
  }

  _upload(unit, tex, source) {
    const gl = this.gl;
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.activeTexture(gl.TEXTURE0);
  }

  resize(cssW, cssH, dpr) {
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  setBase(bitmap) { this._upload(this.gl.TEXTURE0, this.skyTex, bitmap); this.hasSky = true; }
  setPatch(bitmap, meta) { this._upload(this.gl.TEXTURE1, this.patchTex, bitmap); this.patch = { ...meta }; this.hasPatch = true; }
  clearPatch() { this.hasPatch = false; }

  /** opts: { ground, grid, eqGrid, galGrid, expo, gam, flip } */
  render(view, lst, latDeg, opts) {
    const gl = this.gl, U = this.U, D2R = Math.PI / 180;
    gl.useProgram(this.prog);
    gl.uniform2f(U.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(U.uFov, view.fov);
    gl.uniform1f(U.uAz, view.az);
    gl.uniform1f(U.uAlt, view.alt);
    gl.uniform1f(U.uLat, latDeg * D2R);
    gl.uniform1f(U.uLst, lst);
    gl.uniform1f(U.uExpo, opts.expo);
    gl.uniform1f(U.uGam, opts.gam);
    gl.uniform1i(U.uProj, view.proj);
    gl.uniform1i(U.uGround, opts.ground);
    gl.uniform1i(U.uGrid, opts.grid);
    gl.uniform1i(U.uEqGrid, opts.eqGrid);
    gl.uniform1i(U.uGalGrid, opts.galGrid);
    gl.uniform1i(U.uHasSky, this.hasSky);
    gl.uniform1i(U.uFlip, opts.flip);
    gl.uniform1i(U.uHasPatch, this.hasPatch && !opts.flip);
    gl.uniform3f(U.uPatchInfo, this.patch.ra * D2R, this.patch.dec * D2R, this.patch.fov * D2R);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}