import cv2, sys
url=open("url720.txt").read().strip()
cap=cv2.VideoCapture(url)
print("opened",cap.isOpened(),cap.get(cv2.CAP_PROP_FPS),cap.get(cv2.CAP_PROP_FRAME_WIDTH),cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
for t in [float(x) for x in sys.argv[1:]]:
    cap.set(cv2.CAP_PROP_POS_MSEC,t*1000)
    ok,f=cap.read()
    print(t,ok)
    if ok: cv2.imwrite(f"frames/t{int(t)}.jpg",f)
