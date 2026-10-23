// 单击查词时跳过的常用词（开发者 10-23：the、a 这种老是点到）。点到它们当成点空白处（照旧翻页、呼出菜单），长按选中照样能查；
// 自己查过的（长按查过一次）下次单击照常查。
// 来源：维基百科「Most common words in English」里牛津英语语料库（Oxford English Corpus，20 多亿词）的前 100 个词（原形），
// 加上它们的变形（is、was、has、did……）和常见缩写（don't、it's……）。
// WebDAV 上 odybo/prompts/common_words.txt 有就用那份（remotePrompts.ts），开发者可以自己加减：一行一个，# 开头的是注释。
export const COMMON_WORDS_TEXT = `# 单击查词时跳过的常用词：一行一个（大小写不分），# 开头的是注释
# 点到这些词当成点空白处；长按选中照样能查；自己查过的词，下次单击照常查
# 来源：牛津英语语料库（Oxford English Corpus）最常见的前 100 个词，加上它们的变形和常见缩写

# 前 100 个（按频率）
the
be
to
of
and
a
in
that
have
i
it
for
not
on
with
he
as
you
do
at
this
but
his
by
from
they
we
say
her
she
or
an
will
my
one
all
would
there
their
what
so
up
out
if
about
who
get
which
go
me
when
make
can
like
time
no
just
him
know
take
people
into
year
your
good
some
could
them
see
other
than
then
now
look
only
come
its
over
think
also
back
after
use
two
how
our
work
first
well
way
even
new
want
because
any
these
give
day
most
us

# 变形
is
am
are
was
were
been
being
has
had
having
does
did
done
doing
says
said
gets
got
goes
went
gone
makes
made
takes
took
taken
knows
knew
known
sees
saw
seen
comes
came
thinks
thought
looks
looked
uses
used
wants
wanted
gives
gave
given
works
worked
years
days
times
ways

# 常见缩写
don't
doesn't
didn't
isn't
aren't
wasn't
weren't
can't
won't
it's
i'm
i've
i'd
i'll
you're
we're
they're
that's
there's
he's
she's
let's
`;

/** 把文字（一行一个词，# 开头是注释）变成一个集合 */
export const parseWordList = (text: string) =>
  new Set(
    text
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*/, '').trim().toLowerCase().replace(/’/g, "'"))
      .filter(Boolean),
  );
