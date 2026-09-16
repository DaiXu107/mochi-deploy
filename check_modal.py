import re
with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()
mm = html.find('id="modal-mask"')
ep = html.find('id="emoji-panel"')
phone = html.find('class="phone"')
print(f'.phone pos: {phone}')
print(f'modal-mask pos: {mm}')
print(f'emoji-panel pos: {ep}')
m = re.search(r'\.modal-mask\s*\{[^}]*z-index:(\d+)', html)
if m: print(f'modal-mask z-index: {m.group(1)}')
m = re.search(r'\.emoji-card\s*\{[^}]*z-index:(\d+)', html)
if m: print(f'emoji-card z-index: {m.group(1)}')
m = re.search(r'\.poke-card\s*\{[^}]*z-index:(\d+)', html)
if m: print(f'poke-card z-index: {m.group(1)}')
m = re.search(r'\.phone\s*\{[^}]*transform', html)
print(f'.phone has transform: {bool(m)}')
# 检查 .phone 的 overflow
m = re.search(r'\.phone\s*\{[^}]*overflow:([^;]+)', html)
if m: print(f'.phone overflow: {m.group(1).strip()}')
# 检查 modal-mask 的完整 CSS
m = re.search(r'\.modal-mask\s*\{([^}]+)\}', html)
if m: print(f'modal-mask CSS: {m.group(1).strip()}')
# 检查 .modal 的完整 CSS
m = re.search(r'\.modal\s*\{([^}]+)\}', html)
if m: print(f'modal CSS: {m.group(1).strip()}')