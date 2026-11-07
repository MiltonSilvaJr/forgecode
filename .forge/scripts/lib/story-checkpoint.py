#!/usr/bin/env python3
"""Fail-closed story checkpoint evidence, pinned to input bytes and directory identity."""
import datetime
import hashlib
import json
import os
import re
import secrets
import stat
import sys

FLAGS = os.O_RDONLY | os.O_NOFOLLOW
DIR_FLAGS = FLAGS | os.O_DIRECTORY

def read_fd(fd):
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        raise ValueError('checkpoint input is not a regular file')
    with os.fdopen(fd, 'rb') as stream:
        return stream.read()

def fingerprint(root, change, stories_fd):
    identity = os.fstat(stories_fd)
    h = hashlib.sha256()
    def add(name, data):
        name = name.encode('utf-8')
        h.update(len(name).to_bytes(8, 'big'))
        h.update(name)
        h.update(len(data).to_bytes(8, 'big'))
        h.update(data)
    for name, path in [('tasks', os.path.join(change, 'tasks.md')), ('manifest', os.path.join(change, 'manifest.yaml')), ('runtime', os.path.join(root, '.forge', 'FORGE.md'))]:
        add(name, read_fd(os.open(path, FLAGS)))
    names = sorted(name for name in os.listdir(stories_fd) if name.startswith('STORY-') and (name.endswith('.md') or name.endswith('.component.json')))
    if not names:
        raise ValueError('no stories to verify')
    for name in names:
        add(name, read_fd(os.open(name, FLAGS, dir_fd=stories_fd)))
    return json.dumps({'device': identity.st_dev, 'inode': identity.st_ino, 'sha256': h.hexdigest()}, sort_keys=True)

def main():
    action, root, change, story = sys.argv[1:5]
    stories_path = os.path.join(change, 'stories')
    fd = os.open(stories_path, DIR_FLAGS)
    try:
        name = story + '.verification.yaml'
        if action == 'clear':
            try: os.unlink(name, dir_fd=fd)
            except FileNotFoundError: pass
            return
        if action == 'snapshot':
            print(fingerprint(root, change, fd))
            return
        if action == 'component':
            story_text = read_fd(os.open(story + '.md', FLAGS, dir_fd=fd)).decode('utf-8')
            parts = story_text.split('---', 2)
            if len(parts) != 3 or parts[0].strip():
                raise ValueError('invalid story frontmatter')
            markers = [line for line in parts[1].splitlines() if re.match(r'^\s*component_test\s*:', line)]
            if len(markers) > 1 or (markers and markers[0] != 'component_test: true'):
                raise ValueError('invalid component_test marker')
            config_name = story + '.component.json'
            try:
                content = read_fd(os.open(config_name, FLAGS, dir_fd=fd))
            except FileNotFoundError:
                if markers: raise ValueError('component configuration missing')
                print('')
                return
            if not markers: raise ValueError('component configuration has no marker')
            print(content.decode('utf-8'))
            return
        if action != 'write':
            raise ValueError('unknown action')
        expected, status, commit = sys.argv[5:8]
        component = json.loads(sys.argv[8]) if len(sys.argv) > 8 and sys.argv[8] else None
        def verify_snapshot():
            # Directory FD anchors writes; pathname must still name that same directory.
            pathinfo = os.stat(stories_path, follow_symlinks=False)
            info = os.fstat(fd)
            if not stat.S_ISDIR(pathinfo.st_mode) or (pathinfo.st_dev, pathinfo.st_ino) != (info.st_dev, info.st_ino) or fingerprint(root, change, fd) != expected:
                raise ValueError('story checkpoint inputs changed during verification')
        verify_snapshot()
        values = sys.stdin.buffer.read().split(b'\0')
        if values[-1] == b'': values.pop()
        if len(values) % 3: raise ValueError('invalid check records')
        checks = [{'name': values[i].decode(), 'command': values[i+1].decode(), 'status': values[i+2].decode()} for i in range(0, len(values), 3)]
        record = {'story': story, 'status': status, 'verified_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'commit': commit, 'checks': checks, 'inputs': json.loads(expected)}
        if component is not None: record['component'] = component
        tmp = '.' + story + '.' + secrets.token_hex(16) + '.tmp'
        published = False
        try:
            filefd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            with os.fdopen(filefd, 'w', encoding='utf-8') as output:
                json.dump(record, output, ensure_ascii=False)
                output.write('\n')
            verify_snapshot()
            os.replace(tmp, name, src_dir_fd=fd, dst_dir_fd=fd)
            published = True
            verify_snapshot()
        except Exception:
            if published:
                try: os.unlink(name, dir_fd=fd)
                except FileNotFoundError: pass
            raise
        finally:
            try: os.unlink(tmp, dir_fd=fd)
            except FileNotFoundError: pass
    finally:
        os.close(fd)

if __name__ == '__main__':
    try: main()
    except (OSError, ValueError, IndexError) as exc:
        print(f'FAIL (story checkpoint: {exc})', file=sys.stderr)
        sys.exit(1)
