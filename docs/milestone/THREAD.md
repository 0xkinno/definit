# Thread draft

1/ Your agent paid on an AI verdict. The verdict was appealed. The money is gone.
@GenLayer DEFINIT v2: the verdict itself releases the payment, and only after GenLayer finalizes it.

2/ Builders treat finality as something you check: a status, a read, a timer. On GenLayer it is something the protocol delivers. A finalized-stage message does not exist until the deciding transaction has survived its appeal window.

3/ So DEFINIT v2 holds no clock. The vault accepts release only from a finalized message sent by the bound gate. No reader, timer, caller or agent can move money ahead of an appeal.

4/ Across 13 recorded protocol timelines, a pay-on-Accepted agent executed 13/13 payments before the decision was final, a fixed-timer agent 0/13, DEFINIT v1's funder path 3/3 (measured separately), and DEFINIT v2 0/13, with 0 legitimate releases refused.

5/ The honest part: the appeal I ran did not change a verdict, and everything is on Studio-dev. v1's funder hole is measured, not guessed. https://definit-snowy.vercel.app/milestone  https://github.com/0xkinno/definit
